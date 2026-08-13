const express = require('express');
const {
    syncUserActivities,
    ensureUserForSync,
    fetchActivityDetail,
    fetchActivityStreams,
    recomputeActivityKpiSnapshots,
    getUserStore,
    getActivityStore,
    getActivityStreamStore,
    getActivityKpiSnapshotStore
} = require('../services/sync');
const {
    normalizeStreamKeys,
    normalizeStreamRequest
} = require('../stream_config');
const { isMongoConnected } = require('../db');
const ActivityTypes = require('../../js/strava_activity_types');
const { SNAPSHOT_SCHEMA_VERSION } = require('../activity_kpis');
const {
    ActivityPageError,
    STRAVA_SUMMARY_FIELDS,
    STREAM_SAMPLE_FIELDS,
    findActivityPage,
    findLegacyActivities,
    parseActivityIds,
    stripStreamSamples,
    useLegacyActivityListContract
} = require('../activity_pagination');
const {
    normalizeSlug,
    isUserConnected,
    buildConnectionStatus
} = require('../services/connection');

const router = express.Router();
const ACTIVITY_TYPE_KEYS = new Set(ActivityTypes.getAllActivityTypes().map((entry) => entry.key));

function parseCsvList(value) {
    if (Array.isArray(value)) {
        return value.flatMap(parseCsvList);
    }
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function buildActivityFilter(query) {
    const filter = {};
    const users = parseCsvList(query.users || query.user).map((slug) => slug.toLowerCase());
    if (users.length === 1) {
        filter.user_slug = users[0];
    } else if (users.length > 1) {
        filter.user_slug = { $in: users };
    }
    if (query.city) {
        filter.location_city = query.city;
    }
    if (query.state || query.regionState) {
        filter.location_state = query.state || query.regionState;
    }
    if (query.country) {
        filter.location_country = query.country;
    }
    if (query.from || query.to) {
        filter.start_date = {};
        if (query.from) {
            filter.start_date.$gte = query.from;
        }
        if (query.to) {
            filter.start_date.$lte = query.to;
        }
    }
    const requestedTypeKeys = getRequestedActivityTypeKeys(query);
    if (requestedTypeKeys.length) {
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
    return filter;
}

function getRequestedActivityTypeKeys(query) {
    return Array.from(new Set(parseCsvList(query.types || query.type)
        .map((type) => ActivityTypes.normalizeActivityTypeKey(type))
        .filter(Boolean)));
}

function matchesRequestedActivityTypes(activity, requestedTypeKeys) {
    if (!requestedTypeKeys.length) {
        return true;
    }
    const activityKey = ActivityTypes.normalizeActivityTypeKey(activity);
    return requestedTypeKeys.includes(activityKey);
}

async function findActivitiesForQuery(query, options) {
    const requestedTypeKeys = getRequestedActivityTypeKeys(query || {});
    const findOptions = Object.assign({}, options || {});
    const requestedLimit = typeof findOptions.limit === 'number' ? findOptions.limit : null;
    if (requestedTypeKeys.length && requestedLimit !== null) {
        delete findOptions.limit;
    }
    const activities = await getActivityStore().find(buildActivityFilter(query || {}), findOptions);
    return requestedLimit !== null ? activities.slice(0, requestedLimit) : activities;
}

function isTruthy(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

function normalizeHexColor(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
        return raw.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{8}$/.test(raw)) {
        return raw.slice(0, 7).toLowerCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
        return `#${raw}`.toLowerCase();
    }
    if (/^[0-9a-fA-F]{8}$/.test(raw)) {
        return `#${raw.slice(0, 6)}`.toLowerCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
        return `#${raw.slice(1).split('').map((character) => character + character).join('')}`.toLowerCase();
    }
    return null;
}

function parseLineThickness(value) {
    if (value === undefined || value === null || value === '') {
        return { valid: true, value: null };
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 32) {
        return { valid: false };
    }
    return { valid: true, value: numeric };
}

function parseLineOpacity(value) {
    if (value === undefined || value === null || value === '') {
        return { valid: true, value: null };
    }
    let numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return { valid: false };
    }
    if (numeric > 1) {
        numeric /= 100;
    }
    if (numeric < 0 || numeric > 1) {
        return { valid: false };
    }
    return { valid: true, value: numeric };
}

function parseAnimationSpeedMultiplier(value) {
    if (value === undefined || value === null || value === '') {
        return { valid: true, value: null };
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0.25 || numeric > 4) {
        return { valid: false };
    }
    return { valid: true, value: numeric };
}

function hasUserScope(query) {
    return parseCsvList((query || {}).users || (query || {}).user)
        .map(normalizeSlug)
        .filter(Boolean)
        .length > 0;
}

function parseActivityTypeOverride(value) {
    if (value === undefined || value === null || value === '') {
        return { valid: true, value: '', label: '' };
    }
    const label = String(value || '').trim().replace(/\s+/g, ' ');
    const key = ActivityTypes.normalizeActivityTypeKey(label);
    if (!key || label.length > 80) {
        return { valid: false, value: '', label: '' };
    }
    return {
        valid: true,
        value: key,
        label: ACTIVITY_TYPE_KEYS.has(key) ? '' : label
    };
}

function getActivityStreamData(activity) {
    const streamData = activity && activity.stream_data && typeof activity.stream_data === 'object'
        ? Object.assign({}, activity.stream_data)
        : {};
    if (Array.isArray(activity && activity.stream_latlng) && activity.stream_latlng.length && !streamData.latlng) {
        streamData.latlng = activity.stream_latlng;
    }
    if (Array.isArray(activity && activity.stream_velocity_smooth) && activity.stream_velocity_smooth.length && !streamData.velocity_smooth) {
        streamData.velocity_smooth = activity.stream_velocity_smooth;
    }
    if (Array.isArray(activity && activity.stream_time) && activity.stream_time.length && !streamData.time) {
        streamData.time = activity.stream_time;
    }
    return streamData;
}

function hasRequestedStreamCache(activity, streamRequest) {
    if (!activity || activity.stream_resolution !== streamRequest.resolution || activity.stream_series_type !== streamRequest.seriesType) {
        return false;
    }
    const requestedKeys = normalizeStreamKeys(streamRequest.keys);
    const canonicalStreams = getActivityStreamData(activity);
    return requestedKeys.every((key) => Array.isArray(canonicalStreams[key]) && canonicalStreams[key].length);
}

function buildActivityStreamResponse(activity, cached) {
    const streams = getActivityStreamData(activity);
    const streamKeys = normalizeStreamKeys(activity.stream_keys && activity.stream_keys.length ? activity.stream_keys : Object.keys(streams));
    return {
        activity_id: activity.strava_id,
        strava_id: activity.strava_id,
        provider: 'strava',
        streams: streams,
        stream_keys: streamKeys,
        requested_keys: normalizeStreamKeys(activity.stream_requested_keys),
        resolution: activity.stream_resolution || 'high',
        series_type: activity.stream_series_type || 'time',
        metadata: activity.stream_metadata || {},
        fetched_at: activity.stream_fetched_at || null,
        cached: Boolean(cached)
    };
}

function getStorageLabel() {
    return isMongoConnected() ? 'MongoDB' : 'memory';
}

function getExternalErrorMessage(error) {
    return error && error.message ? error.message : 'Strava sync unavailable';
}

function hasAnyStreamData(activity) {
    return Object.values(getActivityStreamData(activity)).some((values) => Array.isArray(values) && values.length > 0);
}

router.post('/sync/:slug', async (req, res) => {
    const userSlug = normalizeSlug(req.params.slug);
    if (!userSlug) {
        res.status(400).json({ error: 'Invalid user slug' });
        return;
    }
    try {
        const user = await ensureUserForSync(userSlug);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (!isUserConnected(user)) {
            res.status(409).json(Object.assign({ error: 'Strava connection required' }, buildConnectionStatus(user)));
            return;
        }
        const syncResult = await syncUserActivities(user);
        const safeResult = Object.assign({}, syncResult, {
            connection: buildConnectionStatus(syncResult.user)
        });
        delete safeResult.user;
        res.json(safeResult);
    } catch (error) {
        let storedActivityCount = 0;
        try {
            storedActivityCount = await getActivityStore().count({ user_slug: userSlug });
        } catch (cacheError) {
            console.error('[Activity Cache Unavailable]', {
                user: userSlug,
                storage: getStorageLabel(),
                error: cacheError && cacheError.message ? cacheError.message : 'Unknown database error'
            });
            res.status(500).json({ error: 'Activity database is unavailable' });
            return;
        }
        console.warn('[Strava Sync Unavailable]', {
            user: userSlug,
            storage: getStorageLabel(),
            storedActivityCount: storedActivityCount,
            error: getExternalErrorMessage(error)
        });
        const payload = {
            source: `${getStorageLabel()} cache`,
            storage: getStorageLabel(),
            syncAvailable: false,
            syncError: getExternalErrorMessage(error),
            recordsInserted: 0,
            recordsUpdated: 0,
            stravaSummaryFetchedCount: 0,
            stravaDetailFetchedCount: 0,
            stravaRecordsPulled: 0,
            storedActivityCount: storedActivityCount,
            activitiesSynced: 0
        };
        const latestUser = await getUserStore().findOne({ slug: userSlug });
        Object.assign(payload, latestUser ? buildConnectionStatus(latestUser) : {});
        res.status(storedActivityCount > 0 ? 200 : (payload.needsReconnect ? 409 : 503)).json(payload);
    }
});

router.get('/sync/:slug/status', async (req, res) => {
    const userSlug = normalizeSlug(req.params.slug);
    if (!userSlug) {
        res.status(400).json({ error: 'Invalid user slug' });
        return;
    }
    const user = await getUserStore().findOne({ slug: userSlug });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(Object.assign(buildConnectionStatus(user), {
        progress: user.sync_progress || null,
        retryAt: user.sync_retry_at || null,
        error: user.sync_error || null,
        totalActivities: Number(user.total_activities || 0),
        backfillComplete: user.backfill_complete === true
    }));
});

router.get('/users/:slug/activity-kpis', async (req, res) => {
    const userSlug = String(req.params.slug || '').toLowerCase();
    const snapshotStore = getActivityKpiSnapshotStore();
    let snapshots = await snapshotStore.find({ user_slug: userSlug }, { sort: { category_label: 1 } });
    const snapshotsAreStale = snapshots.some((snapshot) => Number(snapshot.schema_version || 0) < SNAPSHOT_SCHEMA_VERSION);
    if ((!snapshots.length || snapshotsAreStale) && await getActivityStore().count({ user_slug: userSlug })) {
        snapshots = await recomputeActivityKpiSnapshots(userSlug);
    }
    res.json(snapshots);
});

router.get('/activities', async (req, res, next) => {
    if (!hasUserScope(req.query)) {
        res.status(400).json({ error: 'A user slug is required' });
        return;
    }
    try {
        const ids = parseActivityIds(req.query.ids, 'strava');
        const filter = buildActivityFilter(req.query);
        if (ids.length) filter.strava_id = { $in: ids };
        if (useLegacyActivityListContract(req.query)) {
            res.json(await findLegacyActivities({
                store: getActivityStore(), filter, fields: STRAVA_SUMMARY_FIELDS, query: req.query
            }));
            return;
        }
        res.json(await findActivityPage({
            store: getActivityStore(),
            filter,
            provider: 'strava',
            idField: 'strava_id',
            fields: STRAVA_SUMMARY_FIELDS,
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

router.get('/activities/stats', async (req, res) => {
    if (!hasUserScope(req.query)) {
        res.status(400).json({ error: 'A user slug is required' });
        return;
    }
    const activities = await findActivitiesForQuery(req.query, {
        select: {
            _id: 0, activity_type_key: 1, activity_type_override: 1, sport_type: 1,
            type: 1, distance: 1, elapsed_time: 1, total_elevation_gain: 1
        }
    });
    const stats = activities.reduce((accumulator, activity) => {
        accumulator.distance += Number(activity.distance || 0);
        accumulator.time += Number(activity.elapsed_time || 0);
        accumulator.count += 1;
        accumulator.elevation += Number(activity.total_elevation_gain || 0);
        const typeKey = ActivityTypes.normalizeActivityTypeKey(activity);
        accumulator.activityCounts[typeKey] = (accumulator.activityCounts[typeKey] || 0) + 1;
        return accumulator;
    }, { distance: 0, time: 0, count: 0, elevation: 0, activityCounts: {} });
    res.json(stats);
});

router.get('/activities/types', async (req, res) => {
    if (!hasUserScope(req.query)) {
        res.status(400).json({ error: 'A user slug is required' });
        return;
    }
    const activities = await findActivitiesForQuery(req.query, {
        select: {
            _id: 0, activity_type_key: 1, activity_type_override: 1,
            activity_type_override_label: 1, sport_type: 1, type: 1
        }
    });
    res.json(ActivityTypes.sortActivityTypesByCount(ActivityTypes.countActivityTypes(activities)).map((entry) => entry.key));
});

router.get('/activities/:id', async (req, res) => {
    const activityId = Number(req.params.id);
    if (!activityId) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }

    const userSlug = normalizeSlug(req.query.user);
    if (!userSlug) {
        res.status(400).json({ error: 'A valid user slug is required' });
        return;
    }
    const filter = { strava_id: activityId, user_slug: userSlug };

    const detailProjection = STREAM_SAMPLE_FIELDS.reduce((projection, field) => {
        projection[field] = 0;
        return projection;
    }, {});
    let activity = await getActivityStore().findOne(filter, { select: detailProjection });
    const shouldRefresh = isTruthy(req.query.refresh);
    const shouldHydrate = isTruthy(req.query.hydrate);

    if (!activity) {
        const user = await getUserStore().findOne({ slug: userSlug });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        try {
            activity = await fetchActivityDetail(user, activityId);
            await recomputeActivityKpiSnapshots(userSlug);
            res.json(stripStreamSamples(activity));
        } catch (error) {
            console.warn('[Strava Activity Detail Unavailable]', {
                activityId: activityId,
                user: userSlug,
                error: getExternalErrorMessage(error)
            });
            res.status(503).json({ error: 'Activity is not cached and Strava is unavailable' });
        }
        return;
    }

    if (shouldRefresh || (shouldHydrate && !activity.detail_fetched_at)) {
        const user = await getUserStore().findOne({ slug: activity.user_slug });
        if (user) {
            try {
                activity = await fetchActivityDetail(user, activityId);
                await recomputeActivityKpiSnapshots(userSlug);
            } catch (error) {
                console.warn('[Strava Activity Hydration Skipped]', {
                    activityId: activityId,
                    user: activity.user_slug,
                    error: getExternalErrorMessage(error)
                });
            }
        }
    }

    res.json(stripStreamSamples(activity));
});

router.patch('/activities/:id', async (req, res) => {
    const activityId = Number(req.params.id);
    if (!activityId) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }

    const body = req.body || {};
    const hasLineColor = Object.prototype.hasOwnProperty.call(body, 'line_color');
    const hasLineThickness = Object.prototype.hasOwnProperty.call(body, 'line_thickness');
    const hasLineOpacity = Object.prototype.hasOwnProperty.call(body, 'line_opacity');
    const hasAnimationSpeed = Object.prototype.hasOwnProperty.call(body, 'animation_speed_multiplier');
    const hasActivityTypeOverride = Object.prototype.hasOwnProperty.call(body, 'activity_type_override');
    if (!hasLineColor && !hasLineThickness && !hasLineOpacity && !hasAnimationSpeed && !hasActivityTypeOverride) {
        res.status(400).json({ error: 'At least one line setting or workout type is required' });
        return;
    }

    const updates = {};
    if (hasLineColor) {
        const lineColor = normalizeHexColor(body.line_color);
        if (lineColor === null) {
            res.status(400).json({ error: 'line_color must be a hex color like #7c3aed' });
            return;
        }
        updates.line_color = lineColor;
    }
    if (hasLineThickness) {
        const thickness = parseLineThickness(body.line_thickness);
        if (!thickness.valid) {
            res.status(400).json({ error: 'line_thickness must be between 1 and 32 pixels' });
            return;
        }
        updates.line_thickness = thickness.value;
    }
    if (hasLineOpacity) {
        const opacity = parseLineOpacity(body.line_opacity);
        if (!opacity.valid) {
            res.status(400).json({ error: 'line_opacity must be between 0 and 100 percent' });
            return;
        }
        updates.line_opacity = opacity.value;
    }
    if (hasAnimationSpeed) {
        const speed = parseAnimationSpeedMultiplier(body.animation_speed_multiplier);
        if (!speed.valid) {
            res.status(400).json({ error: 'animation_speed_multiplier must be between 0.25 and 4' });
            return;
        }
        updates.animation_speed_multiplier = speed.value;
    }
    let activityTypeOverride = null;
    if (hasActivityTypeOverride) {
        activityTypeOverride = parseActivityTypeOverride(body.activity_type_override);
        if (!activityTypeOverride.valid) {
            res.status(400).json({ error: 'activity_type_override must be a supported type or a custom label up to 80 characters' });
            return;
        }
    }

    const userSlug = normalizeSlug(req.query.user);
    if (!userSlug) {
        res.status(400).json({ error: 'A valid user slug is required' });
        return;
    }
    const filter = { strava_id: activityId, user_slug: userSlug };

    const existing = await getActivityStore().findOne(filter);
    if (!existing) {
        res.status(404).json({ error: 'Activity not found' });
        return;
    }

    if (hasActivityTypeOverride) {
        updates.activity_type_override = activityTypeOverride.value;
        updates.activity_type_override_label = activityTypeOverride.label;
        updates.activity_type_key = activityTypeOverride.value || ActivityTypes.normalizeActivityTypeKey({
            sport_type: existing.sport_type,
            type: existing.type
        });
        if (!hasLineColor) {
            updates.line_color = '';
        }
    }

    const updated = await getActivityStore().updateOne(filter, updates);
    if (hasActivityTypeOverride) {
        await recomputeActivityKpiSnapshots(userSlug);
    }
    res.json(stripStreamSamples(updated));
});

router.get('/activities/:id/streams', async (req, res) => {
    const activityId = Number(req.params.id);
    if (!activityId) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const streamRequest = normalizeStreamRequest({
        profile: req.query.profile,
        keys: req.query.keys,
        resolution: req.query.resolution,
        seriesType: req.query.series_type || req.query.seriesType
    });

    const userSlug = normalizeSlug(req.query.user);
    if (!userSlug) {
        res.status(400).json({ error: 'A valid user slug is required' });
        return;
    }
    const filter = { strava_id: activityId, user_slug: userSlug };

    const activityStore = getActivityStore();
    const streamStore = getActivityStreamStore();
    const activity = await activityStore.findOne(filter, {
        select: { _id: 0, strava_id: 1, user_slug: 1 }
    });
    if (!activity) {
        res.status(404).json({ error: 'Activity not found' });
        return;
    }

    let streamActivity = await streamStore.findOne(filter);
    if (!streamActivity) {
        streamActivity = await activityStore.findOne(filter, {
            select: {
                _id: 0, strava_id: 1, stream_resolution: 1, stream_series_type: 1,
                stream_data: 1, stream_keys: 1, stream_requested_keys: 1,
                stream_metadata: 1, stream_latlng: 1, stream_velocity_smooth: 1,
                stream_time: 1, stream_fetched_at: 1
            }
        });
    }

    if (hasRequestedStreamCache(streamActivity, streamRequest) && !isTruthy(req.query.refresh)) {
        res.json(buildActivityStreamResponse(streamActivity, true));
        return;
    }

    const user = await getUserStore().findOne({ slug: activity.user_slug });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    try {
        const refreshedStreamActivity = await fetchActivityStreams(user, activityId, streamRequest);
        res.json(buildActivityStreamResponse(refreshedStreamActivity, false));
    } catch (error) {
        console.warn('[Strava Activity Streams Unavailable]', {
            activityId: activityId,
            user: activity.user_slug,
            cached: hasAnyStreamData(streamActivity),
            error: getExternalErrorMessage(error)
        });
        if (hasAnyStreamData(streamActivity)) {
            res.json(Object.assign(buildActivityStreamResponse(streamActivity, true), {
                partial: true,
                refreshError: getExternalErrorMessage(error)
            }));
            return;
        }
        res.status(503).json({ error: 'Activity streams are not cached and Strava is unavailable' });
    }
});

module.exports = router;
