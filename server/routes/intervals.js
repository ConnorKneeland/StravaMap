const crypto = require('crypto');
const express = require('express');
const ActivityTypes = require('../../js/strava_activity_types');
const { SNAPSHOT_SCHEMA_VERSION } = require('../activity_kpis');
const { normalizeStreamKeys } = require('../stream_config');
const { normalizeSlug } = require('../services/connection');
const { getIntervalsConfig } = require('../config/intervals');
const {
    PROVIDER,
    getConnectionStore,
    isIntervalsSlugAccessible,
    createIntervalsOAuthState,
    claimIntervalsOAuthState,
    consumeIntervalsOAuthState,
    buildIntervalsAuthorizationUrl,
    exchangeIntervalsCode,
    bindIntervalsConnection,
    normalizeIntervalsReturnUrl,
    createOwnerToken,
    verifyOwnerToken,
    requireIntervalsOwner,
    buildIntervalsConnectionStatus
} = require('../services/intervals_auth');
const { registerIntervalsAccount } = require('../services/intervals_registration');
const {
    getIntervalsActivityStore,
    getIntervalsActivityStreamStore,
    getIntervalsKpiStore,
    fetchIntervalsActivityDetail,
    fetchIntervalsActivityStreams,
    recomputeIntervalsKpis,
    syncIntervalsActivities,
    reconcileIntervalsActivity,
    reconcileRecentIntervalsActivities
} = require('../services/intervals_sync');
const {
    isStravaExportImportActive,
    importStravaExportZipFile,
    saveRequestToTemporaryZip,
    removeTemporaryZip
} = require('../services/strava_export_import');
const {
    ActivityPageError,
    INTERVALS_SUMMARY_FIELDS,
    STREAM_SAMPLE_FIELDS,
    findActivityPage,
    findLegacyActivities,
    parseActivityIds,
    stripStreamSamples,
    useLegacyActivityListContract
} = require('../activity_pagination');

const router = express.Router();

function isTruthy(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

function parseList(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function getBearerToken(req) {
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
}

function hasOwnerAccess(req, slug) {
    try {
        verifyOwnerToken(getBearerToken(req), slug);
        return true;
    } catch (error) {
        return false;
    }
}

function getIntervalsActivityId(req) {
    const id = String(req.params.id || '').trim();
    return id && id.length <= 128 ? id : '';
}

function normalizeHexColor(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
    if (/^#[0-9a-f]{8}$/i.test(raw)) return raw.slice(0, 7).toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
        return `#${raw.slice(1).split('').map((part) => part + part).join('')}`.toLowerCase();
    }
    return null;
}

function parseBoundedNumber(value, minimum, maximum) {
    if (value === undefined || value === null || value === '') return { valid: true, value: null };
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum
        ? { valid: true, value: number }
        : { valid: false };
}

function sendIntervalsError(res, error, fallbackStatus) {
    const status = Number(error && (error.statusCode || error.status) || fallbackStatus || 500);
    res.status(status).json({
        error: error && error.message ? error.message : 'Intervals.icu request failed',
        code: error && error.code ? error.code : 'intervals_error'
    });
}

function safeRedirectError(res, record, error) {
    const target = normalizeIntervalsReturnUrl(record && record.return_url, record && record.slug || 'connor', false);
    const separator = target.includes('?') ? '&' : '?';
    res.redirect(`${target}${separator}intervals_error=${encodeURIComponent(error.code || 'oauth_failed')}`);
}

router.get('/intervals/connect/:slug', async (req, res) => {
    try {
        const slug = normalizeSlug(req.params.slug);
        const state = await createIntervalsOAuthState(slug, req.query.return_url);
        res.redirect(buildIntervalsAuthorizationUrl(state));
    } catch (error) {
        sendIntervalsError(res, error, 400);
    }
});

router.get('/intervals/callback', async (req, res) => {
    let record;
    try {
        if (!req.query.state) {
            throw Object.assign(new Error('Intervals.icu did not return an authorization code'), {
                statusCode: 400, code: req.query.error || 'authorization_denied'
            });
        }
        record = await claimIntervalsOAuthState(req.query.state);
        if (req.query.error || !req.query.code) {
            throw Object.assign(new Error('Intervals.icu authorization was not completed'), {
                statusCode: 400, code: req.query.error || 'authorization_denied'
            });
        }
        const tokenData = await exchangeIntervalsCode(req.query.code);
        const connection = await bindIntervalsConnection(record.slug, tokenData);
        await consumeIntervalsOAuthState(record);
        const ownerToken = createOwnerToken(record.slug, connection.provider_athlete_id);
        res.redirect(normalizeIntervalsReturnUrl(record.return_url, record.slug, true, ownerToken));
        setImmediate(() => {
            syncIntervalsActivities(record.slug).catch((error) => {
                console.error('[Intervals.icu Initial Sync Failed]', { slug: record.slug, error: error.message });
            });
        });
    } catch (error) {
        console.warn('[Intervals.icu OAuth Failed]', { error: error.message, code: error.code });
        if (record) {
            safeRedirectError(res, record, error);
            return;
        }
        sendIntervalsError(res, error, 400);
    }
});

router.post('/intervals/register', async (req, res) => {
    try {
        const result = await registerIntervalsAccount(req.body || {});
        res.status(result.created ? 201 : 200).json({
            slug: result.slug,
            map_url: result.map_url
        });
    } catch (error) {
        const status = Number(error && error.statusCode || 500);
        if (status >= 500) {
            console.error('[Intervals.icu Registration Failed]', error && error.message ? error.message : error);
        }
        res.status(status).json(Object.assign({
            error: error && error.message
                ? error.message
                : 'Your Intervals.icu map could not be created. Please try again.',
            code: error && error.code ? error.code : 'intervals_registration_failed'
        }, error && error.details || {}));
    }
});

router.get('/intervals/user/:slug/status', async (req, res) => {
    const slug = normalizeSlug(req.params.slug);
    if (!slug || !(await isIntervalsSlugAccessible(slug))) {
        res.status(404).json({ error: 'Intervals.icu is not enabled for this user' });
        return;
    }
    const connection = await getConnectionStore().findOne({ connection_key: `${PROVIDER}:${slug}` });
    res.json(Object.assign(buildIntervalsConnectionStatus(connection, slug), {
        enabled: true,
        owner: hasOwnerAccess(req, slug),
        error: connection && connection.sync_error || null,
        retryAt: connection && connection.sync_retry_at || null
    }));
});

router.post('/intervals/sync/:slug', requireIntervalsOwner, async (req, res) => {
    try {
        res.json(await syncIntervalsActivities(req.params.slug));
    } catch (error) {
        sendIntervalsError(res, error, 503);
    }
});

router.get('/intervals/activities', async (req, res, next) => {
    const slug = normalizeSlug(req.query.user);
    if (!slug || !(await isIntervalsSlugAccessible(slug))) {
        res.status(400).json({ error: 'A valid Intervals.icu user slug is required' });
        return;
    }
    const filter = { user_slug: slug, dedupe_hidden: { $ne: true } };
    if (req.query.from || req.query.to) {
        filter.start_date = {};
        if (req.query.from) filter.start_date.$gte = req.query.from;
        if (req.query.to) filter.start_date.$lte = req.query.to;
    }
    const requestedTypes = parseList(req.query.types || req.query.type)
        .map((value) => ActivityTypes.normalizeActivityTypeKey(value))
        .filter(Boolean);
    if (requestedTypes.length) {
        const requestedTypeKeys = Array.from(new Set(requestedTypes));
        filter.$or = [
            { activity_type_override: { $in: requestedTypeKeys } },
            {
                activity_type_override: { $in: ['', null] },
                activity_type_key: { $in: requestedTypeKeys }
            },
            {
                activity_type_override: { $exists: false },
                activity_type_key: { $in: requestedTypeKeys }
            }
        ];
    }
    try {
        const ids = parseActivityIds(req.query.ids, 'intervals_icu');
        if (ids.length) filter.intervals_activity_id = { $in: ids };
        if (useLegacyActivityListContract(req.query)) {
            const records = await findLegacyActivities({
                store: getIntervalsActivityStore(), filter, fields: INTERVALS_SUMMARY_FIELDS, query: req.query
            });
            res.json(records);
            return;
        }
        res.json(await findActivityPage({
            store: getIntervalsActivityStore(),
            filter,
            provider: 'intervals_icu',
            idField: 'intervals_activity_id',
            fields: INTERVALS_SUMMARY_FIELDS,
            query: req.query
        }));
    } catch (error) {
        if (error instanceof ActivityPageError) {
            res.status(error.statusCode).json({ error: error.message, code: error.code });
            return;
        }
        next(error);
    }
});

router.post('/intervals/import/strava-export/:slug', requireIntervalsOwner, async (req, res) => {
    const slug = normalizeSlug(req.params.slug);
    if (!slug || !(await isIntervalsSlugAccessible(slug))) {
        req.resume();
        res.status(404).json({ error: 'Intervals.icu is not enabled for this user' });
        return;
    }
    if (isStravaExportImportActive(slug)) {
        req.resume();
        res.status(409).json({ error: 'A Strava export import is already running for this user' });
        return;
    }
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(contentType)) {
        req.resume();
        res.status(415).json({ error: 'Upload the original Strava export ZIP file' });
        return;
    }
    let temporaryUpload;
    try {
        temporaryUpload = await saveRequestToTemporaryZip(req, slug);
        const result = await importStravaExportZipFile(temporaryUpload.path, slug);
        res.json(Object.assign({ uploadedBytes: temporaryUpload.bytes }, result));
    } catch (error) {
        sendIntervalsError(res, error, 400);
    } finally {
        await removeTemporaryZip(temporaryUpload && temporaryUpload.path);
    }
});

router.get('/intervals/users/:slug/activity-kpis', async (req, res) => {
    const slug = normalizeSlug(req.params.slug);
    if (!slug || !(await isIntervalsSlugAccessible(slug))) {
        res.status(404).json({ error: 'Intervals.icu is not enabled for this user' });
        return;
    }
    let snapshots = await getIntervalsKpiStore().find({ user_slug: slug }, { sort: { category_label: 1 } });
    const snapshotsAreStale = snapshots.some((snapshot) => Number(snapshot.schema_version || 0) < SNAPSHOT_SCHEMA_VERSION);
    if ((!snapshots.length || snapshotsAreStale) && await getIntervalsActivityStore().count({ user_slug: slug })) {
        snapshots = await recomputeIntervalsKpis(slug);
    }
    res.json(snapshots);
});

router.get('/intervals/activities/:id', async (req, res) => {
    const id = getIntervalsActivityId(req);
    const slug = normalizeSlug(req.query.user);
    if (!id || !slug || !(await isIntervalsSlugAccessible(slug))) {
        res.status(400).json({ error: 'A valid activity id and user slug are required' });
        return;
    }
    const detailProjection = STREAM_SAMPLE_FIELDS.reduce((projection, field) => {
        projection[field] = 0;
        return projection;
    }, {});
    let activity = await getIntervalsActivityStore().findOne(
        { user_slug: slug, intervals_activity_id: id },
        { select: detailProjection }
    );
    const hydrationRequested = isTruthy(req.query.hydrate) || isTruthy(req.query.refresh);
    if (hydrationRequested && hasOwnerAccess(req, slug)) {
        try {
            activity = await fetchIntervalsActivityDetail(slug, id);
            await recomputeIntervalsKpis(slug);
        } catch (error) {
            if (!activity) return sendIntervalsError(res, error, 503);
        }
    }
    if (!activity) {
        res.status(404).json({ error: 'Activity not found in the public cache' });
        return;
    }
    res.json(stripStreamSamples(activity));
});

router.patch('/intervals/activities/:id', requireIntervalsOwner, async (req, res) => {
    const id = getIntervalsActivityId(req);
    const slug = normalizeSlug(req.query.user);
    if (!id || !slug) {
        res.status(400).json({ error: 'A valid activity id and user slug are required' });
        return;
    }
    const body = req.body || {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, 'line_color')) {
        const value = normalizeHexColor(body.line_color);
        if (value === null) return res.status(400).json({ error: 'line_color must be a hex color' });
        updates.line_color = value;
    }
    for (const [key, minimum, maximum] of [
        ['line_thickness', 1, 32], ['line_opacity', 0, 1], ['animation_speed_multiplier', 0.25, 4]
    ]) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
            let value = body[key];
            if (key === 'line_opacity' && Number(value) > 1) value = Number(value) / 100;
            const parsed = parseBoundedNumber(value, minimum, maximum);
            if (!parsed.valid) return res.status(400).json({ error: `${key} is outside its allowed range` });
            updates[key] = parsed.value;
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'activity_type_override')) {
        const label = String(body.activity_type_override || '').trim().replace(/\s+/g, ' ');
        if (label.length > 80) return res.status(400).json({ error: 'activity_type_override is too long' });
        updates.activity_type_override = label ? ActivityTypes.normalizeActivityTypeKey(label) : '';
        updates.activity_type_override_label = label;
        if (!Object.prototype.hasOwnProperty.call(updates, 'line_color')) updates.line_color = '';
    }
    if (!Object.keys(updates).length) {
        res.status(400).json({ error: 'At least one editable field is required' });
        return;
    }
    const filter = { user_slug: slug, intervals_activity_id: id };
    if (!await getIntervalsActivityStore().findOne(filter)) {
        res.status(404).json({ error: 'Activity not found' });
        return;
    }
    const updated = await getIntervalsActivityStore().updateOne(filter, updates);
    if (Object.prototype.hasOwnProperty.call(updates, 'activity_type_override')) {
        await recomputeIntervalsKpis(slug);
    }
    res.json(stripStreamSamples(updated));
});

function buildStreamResponse(activity, cached) {
    const streams = activity.stream_data || {};
    return {
        activity_id: activity.intervals_activity_id,
        id: activity.intervals_activity_id,
        intervals_activity_id: activity.intervals_activity_id,
        provider: 'intervals_icu',
        streams,
        stream_keys: activity.stream_keys || Object.keys(streams),
        requested_keys: activity.stream_requested_keys || [],
        resolution: activity.stream_resolution || 'high',
        series_type: activity.stream_series_type || 'time',
        metadata: activity.stream_metadata || {},
        fetched_at: activity.stream_fetched_at || null,
        cached: Boolean(cached)
    };
}

function hasStreamSamples(activity) {
    return Boolean(activity && activity.stream_data
        && Object.values(activity.stream_data).some((values) => Array.isArray(values) && values.length));
}

function hasRichStreamSamples(activity) {
    return Boolean(activity && activity.stream_data
        && Object.entries(activity.stream_data).some(([key, values]) => (
            key !== 'latlng' && Array.isArray(values) && values.length
        )));
}

function hasRequestedIntervalsStreamSamples(activity, requestedKeys) {
    if (!requestedKeys.length) return hasRichStreamSamples(activity);
    return requestedKeys.every((key) => Array.isArray(activity && activity.stream_data && activity.stream_data[key])
        && activity.stream_data[key].length);
}

router.get('/intervals/activities/:id/streams', async (req, res) => {
    const id = getIntervalsActivityId(req);
    const slug = normalizeSlug(req.query.user);
    if (!id || !slug || !(await isIntervalsSlugAccessible(slug))) {
        res.status(400).json({ error: 'A valid activity id and user slug are required' });
        return;
    }
    const filter = { user_slug: slug, intervals_activity_id: id };
    const requestedKeys = normalizeStreamKeys(req.query.keys);
    const activityStore = getIntervalsActivityStore();
    const streamStore = getIntervalsActivityStreamStore();
    const activity = await activityStore.findOne(filter, {
        select: { _id: 0, user_slug: 1, intervals_activity_id: 1 }
    });
    if (!activity) {
        res.status(404).json({ error: 'Activity not found' });
        return;
    }
    let streamActivity = await streamStore.findOne(filter);
    if (!streamActivity) {
        streamActivity = await activityStore.findOne(filter, {
            select: {
                _id: 0, intervals_activity_id: 1, stream_resolution: 1,
                stream_series_type: 1, stream_data: 1, stream_keys: 1,
                stream_requested_keys: 1, stream_metadata: 1, stream_latlng: 1,
                stream_velocity_smooth: 1, stream_time: 1, stream_fetched_at: 1
            }
        });
        if (streamActivity && !hasStreamSamples(streamActivity)) {
            const legacyStreams = {};
            if (Array.isArray(streamActivity.stream_latlng) && streamActivity.stream_latlng.length) {
                legacyStreams.latlng = streamActivity.stream_latlng;
            }
            if (Array.isArray(streamActivity.stream_velocity_smooth) && streamActivity.stream_velocity_smooth.length) {
                legacyStreams.velocity_smooth = streamActivity.stream_velocity_smooth;
            }
            if (Array.isArray(streamActivity.stream_time) && streamActivity.stream_time.length) {
                legacyStreams.time = streamActivity.stream_time;
            }
            streamActivity.stream_data = legacyStreams;
        }
    }
    let servedFromCache = hasStreamSamples(streamActivity);
    if ((isTruthy(req.query.refresh)
        || !hasRequestedIntervalsStreamSamples(streamActivity, requestedKeys)) && hasOwnerAccess(req, slug)) {
        try {
            streamActivity = await fetchIntervalsActivityStreams(slug, id);
            servedFromCache = false;
        } catch (error) {
            if (!hasStreamSamples(streamActivity)) return sendIntervalsError(res, error, 503);
            servedFromCache = true;
        }
    }
    res.json(buildStreamResponse(
        streamActivity || { intervals_activity_id: id, stream_data: {} },
        servedFromCache
    ));
});

function timingSafeSecret(received, expected) {
    const left = Buffer.from(String(received || ''));
    const right = Buffer.from(String(expected || ''));
    return Boolean(expected) && left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.post('/intervals/webhook', async (req, res) => {
    const config = getIntervalsConfig();
    const authorization = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const receivedSecret = req.headers['x-intervals-secret'] || authorization || req.query.secret || (req.body && req.body.secret);
    if (!timingSafeSecret(receivedSecret, config.webhookSecret)) {
        res.status(401).json({ error: 'Invalid webhook secret' });
        return;
    }
    const payload = req.body || {};
    const events = Array.isArray(payload.events) ? payload.events : [payload];
    const eventsBySlug = new Map();
    for (const event of events) {
        const athleteId = String(event && (event.athlete_id || event.icu_athlete_id || event.athleteId) || '');
        if (!athleteId) {
            res.status(400).json({ error: 'Webhook event is missing an athlete ID' });
            return;
        }
        let connection;
        try {
            connection = await getConnectionStore().findOne({
                provider: PROVIDER,
                provider_athlete_id: athleteId
            });
        } catch (error) {
            sendIntervalsError(res, error, 503);
            return;
        }
        if (!connection || !(await isIntervalsSlugAccessible(connection.user_slug))) {
            res.status(403).json({ error: 'Webhook athlete is not connected' });
            return;
        }
        if (!eventsBySlug.has(connection.user_slug)) {
            eventsBySlug.set(connection.user_slug, []);
        }
        eventsBySlug.get(connection.user_slug).push(event);
    }
    res.status(200).json({ accepted: true });
    setImmediate(() => {
        eventsBySlug.forEach((slugEvents, slug) => {
            const activityIds = Array.from(new Set(slugEvents.map((event) => event && (
                event.activity_id || (event.activity && event.activity.id)
            )).filter(Boolean).map(String)));
            const tasks = activityIds.map((activityId) => reconcileIntervalsActivity(slug, activityId));
            if (!activityIds.length || slugEvents.some((event) => !event
                || !/^(ACTIVITY_UPLOADED|ACTIVITY_ANALYZED|ACTIVITY_DELETED)$/i.test(String(event.type || '')))) {
                tasks.push(reconcileRecentIntervalsActivities(slug, 14));
            }
            Promise.allSettled(tasks).then((results) => {
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        console.error('[Intervals.icu Webhook Processing Failed]', {
                            slug,
                            activityId: activityIds[index] || null,
                            error: result.reason && result.reason.message || 'Unknown error'
                        });
                    }
                });
            }).catch((error) => {
                console.error('[Intervals.icu Webhook Processing Failed]', {
                    slug,
                    error: error.message
                });
            });
        });
    });
});

module.exports = router;
