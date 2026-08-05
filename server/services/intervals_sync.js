const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getIntervalsActivityModel = require('../models/intervals_activity');
const getIntervalsActivityKpiSnapshotModel = require('../models/intervals_activity_kpi_snapshot');
const { buildKpiSnapshots } = require('../activity_kpis');
const ActivityTypes = require('../../js/strava_activity_types');
const { getIntervalsConfig, isIntervalsSlugEnabled } = require('../config/intervals');
const {
    PROVIDER,
    getConnectionStore,
    buildIntervalsProviderAuthorization
} = require('./intervals_auth');
const { normalizeSlug } = require('./connection');
const { reconcileDuplicateActivitiesForSlug } = require('./intervals_dedupe');

const REQUEST_SPACING_MS = 140;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_LIST_ACTIVITIES = 20000;
const activeSyncs = new Map();
let nextRequestAt = 0;

class IntervalsRequestError extends Error {
    constructor(message, status, retryAfterSeconds, code) {
        super(message);
        this.name = 'IntervalsRequestError';
        this.status = Number(status || 0);
        this.statusCode = this.status || 502;
        this.retryAfterSeconds = Number(retryAfterSeconds || 0);
        this.code = code || 'intervals_request_failed';
    }
}

function getIntervalsActivityStore() {
    return isMongoConnected() ? wrapModel(getIntervalsActivityModel()) : memoryStore.intervalsActivities;
}

function getIntervalsKpiStore() {
    return isMongoConnected()
        ? wrapModel(getIntervalsActivityKpiSnapshotModel())
        : memoryStore.intervalsActivityKpiSnapshots;
}

function compactObject(value) {
    return Object.entries(value || {}).reduce((result, [key, item]) => {
        if (item !== undefined) {
            result[key] = item;
        }
        return result;
    }, {});
}

function asString(value) {
    return value === undefined || value === null || value === '' ? undefined : String(value);
}

function asNumber(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function asBoolean(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
        if (/^(false|0|no)$/i.test(value.trim())) return false;
        if (/^(true|1|yes)$/i.test(value.trim())) return true;
    }
    return Boolean(value);
}

function validDate(value) {
    if (!value) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeLatLng(value) {
    if (!Array.isArray(value) || value.length < 2) {
        return undefined;
    }
    const latitude = asNumber(value[0]);
    const longitude = asNumber(value[1]);
    return latitude === undefined || longitude === undefined ? undefined : [latitude, longitude];
}

function normalizeLatLngs(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(normalizeLatLng).filter(Boolean);
}

function isHiddenIntervalsActivity(activity) {
    if (!activity || typeof activity !== 'object') {
        return true;
    }
    const keys = Object.keys(activity);
    return Boolean(activity._note)
        || (keys.includes('icu_athlete_id') && keys.includes('source')
            && !keys.includes('name') && !keys.includes('type'));
}

function isEligibleIntervalsActivity(activity) {
    return !isHiddenIntervalsActivity(activity)
        && String(activity.source || '').trim().toUpperCase() !== 'STRAVA'
        && Boolean(asString(activity.id) && asString(activity.name) && asString(activity.type)
            && (validDate(activity.start_date) || validDate(activity.start_date_local)));
}

function buildWorkoutCategory(activity) {
    if (activity && activity.race) {
        return 'race';
    }
    const subType = asString(activity && activity.sub_type);
    return subType ? subType.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : undefined;
}

const TRAINING_FIELD_PATTERN = /^(icu_|atl$|ctl$|tsb$|trimp$|training_|fitness$|fatigue$|form$|rpe$|feel$|load$|tss$|ftp$|lthr$|vo2max$|polarization_|zone_|power_|pace_|hr_|intensity|variability|efficiency|decoupling|file_type$|source$|device_name$)/i;

function extractIntervalsMetrics(activity) {
    return Object.entries(activity || {}).reduce((metrics, [key, value]) => {
        if (TRAINING_FIELD_PATTERN.test(key) && key !== 'icu_intervals' && value !== undefined) {
            metrics[key] = value;
        }
        return metrics;
    }, {});
}

function normalizeIntervals(intervals) {
    if (!Array.isArray(intervals)) {
        return undefined;
    }
    return intervals.filter((interval) => interval && typeof interval === 'object').map((interval, index) => Object.assign({
        interval_index: index
    }, interval));
}

function transformIntervalsActivity(slugValue, athleteId, activity, options) {
    if (!isEligibleIntervalsActivity(activity)) {
        return null;
    }
    const slug = normalizeSlug(slugValue);
    const id = String(activity.id);
    const startDate = validDate(activity.start_date) || validDate(activity.start_date_local);
    const detail = options && options.detail;
    const intervalsMetrics = extractIntervalsMetrics(activity);
    return compactObject({
        schema_version: 1,
        activity_key: `${PROVIDER}:${id}`,
        intervals_activity_id: id,
        id,
        user_id: slug,
        user_slug: slug,
        provider: PROVIDER,
        provider_athlete_id: String(athleteId),
        upstream_source: asString(activity.source),
        external_id: asString(activity.external_id),
        name: asString(activity.name),
        description: asString(activity.description),
        type: asString(activity.type),
        sport_type: asString(activity.type),
        sub_type: asString(activity.sub_type),
        activity_type_key: ActivityTypes.normalizeActivityTypeKey({
            type: activity.type,
            sport_type: activity.type,
            sub_type: activity.sub_type
        }),
        workout_category: buildWorkoutCategory(activity),
        start_date: startDate,
        start_date_local: asString(activity.start_date_local),
        timezone: asString(activity.timezone),
        distance: asNumber(activity.distance),
        moving_time: asNumber(activity.moving_time),
        elapsed_time: asNumber(activity.elapsed_time),
        total_elevation_gain: asNumber(activity.total_elevation_gain),
        total_elevation_loss: asNumber(activity.total_elevation_loss),
        average_speed: asNumber(activity.average_speed),
        max_speed: asNumber(activity.max_speed),
        average_heartrate: asNumber(activity.average_heartrate),
        max_heartrate: asNumber(activity.max_heartrate),
        average_cadence: asNumber(activity.average_cadence),
        average_watts: asNumber(activity.icu_average_watts),
        weighted_average_watts: asNumber(activity.icu_weighted_avg_watts),
        max_watts: asNumber(activity.max_watts),
        device_watts: asBoolean(activity.device_watts),
        has_heartrate: asBoolean(activity.has_heartrate),
        calories: asNumber(activity.calories),
        average_temp: asNumber(activity.average_temp),
        device_name: asString(activity.device_name),
        trainer: asBoolean(activity.trainer),
        commute: asBoolean(activity.commute),
        race: asBoolean(activity.race),
        perceived_exertion: asNumber(activity.perceived_exertion !== undefined ? activity.perceived_exertion : activity.icu_rpe),
        start_latlng: normalizeLatLng(activity.start_latlng),
        end_latlng: normalizeLatLng(activity.end_latlng),
        intervals: normalizeIntervals(activity.icu_intervals),
        intervals_metrics: Object.keys(intervalsMetrics).length ? intervalsMetrics : undefined,
        detail_fetched_at: detail ? new Date() : undefined,
        last_synced_at: new Date()
    });
}

function transformIntervalsMap(mapPayload) {
    const latlngs = normalizeLatLngs(mapPayload && mapPayload.latlngs);
    return {
        stream_latlng: latlngs,
        stream_data: latlngs.length ? { latlng: latlngs } : {},
        stream_keys: latlngs.length ? ['latlng'] : [],
        start_latlng: latlngs[0],
        end_latlng: latlngs[latlngs.length - 1],
        map_fetched_at: new Date()
    };
}

const STREAM_ALIASES = {
    latlng: 'latlng',
    location: 'latlng',
    speed: 'velocity_smooth',
    velocity_smooth: 'velocity_smooth',
    time: 'time',
    heartrate: 'heartrate',
    heart_rate: 'heartrate',
    cadence: 'cadence',
    watts: 'watts',
    power: 'watts',
    altitude: 'altitude',
    distance: 'distance',
    temperature: 'temp'
};

function transformIntervalsStreams(payload) {
    const streamData = {};
    (Array.isArray(payload) ? payload : []).forEach((stream) => {
        if (!stream || typeof stream !== 'object' || !Array.isArray(stream.data)) {
            return;
        }
        const rawName = String(stream.type || stream.name || '').trim().toLowerCase();
        const key = STREAM_ALIASES[rawName] || rawName.replace(/[^a-z0-9_]+/g, '_');
        if (key) {
            if (key === 'latlng') {
                streamData[key] = Array.isArray(stream.data2)
                    ? stream.data.map((latitude, index) => normalizeLatLng([latitude, stream.data2[index]])).filter(Boolean)
                    : normalizeLatLngs(stream.data);
            } else {
                streamData[key] = stream.data;
            }
        }
    });
    return {
        stream_data: streamData,
        stream_keys: Object.keys(streamData),
        stream_requested_keys: Object.keys(streamData),
        stream_latlng: streamData.latlng || [],
        stream_velocity_smooth: streamData.velocity_smooth || [],
        stream_time: streamData.time || [],
        stream_fetched_at: new Date(),
        stream_resolution: 'high',
        stream_series_type: 'time'
    };
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRequestSlot() {
    const now = Date.now();
    const wait = Math.max(0, nextRequestAt - now);
    nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_SPACING_MS;
    if (wait) {
        await delay(wait);
    }
}

async function markReconnect(connection, reason) {
    return getConnectionStore().updateOne({ connection_key: connection.connection_key }, {
        connection_status: 'reconnect_required',
        needs_reconnect: true,
        sync_status: 'error',
        sync_error: reason
    });
}

async function intervalsFetchJson(connection, path, params, attempt) {
    await waitForRequestSlot();
    const config = getIntervalsConfig();
    const url = new URL(`${config.apiBase}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    const response = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json',
            Authorization: buildIntervalsProviderAuthorization(connection)
        }
    });
    if (response.status === 401 || (response.status === 403 && connection.auth_type === 'api_key')) {
        const reason = connection.auth_type === 'api_key'
            ? 'Intervals.icu rejected the personal API key; provision a new key'
            : 'Intervals.icu authorization expired or was revoked';
        await markReconnect(connection, reason);
        throw new IntervalsRequestError('Intervals.icu reconnection required', 401, 0, 'reconnect_required');
    }
    if (response.status === 429) {
        const retryHeader = response.headers.get('retry-after');
        const retrySeconds = Number(retryHeader);
        const retryDateMs = retryHeader && !Number.isFinite(retrySeconds) ? new Date(retryHeader).getTime() : NaN;
        const retryAfter = Number.isFinite(retrySeconds)
            ? Math.max(1, retrySeconds)
            : (Number.isFinite(retryDateMs) ? Math.max(1, Math.ceil((retryDateMs - Date.now()) / 1000)) : 1);
        const retryAttempt = Number(attempt || 0);
        if (retryAttempt < MAX_RATE_LIMIT_RETRIES) {
            await delay(Math.max(1000, retryAfter * 1000));
            return intervalsFetchJson(connection, path, params, retryAttempt + 1);
        }
        throw new IntervalsRequestError('Intervals.icu rate limit retry budget exhausted', 429, retryAfter, 'rate_limited');
    }
    if (!response.ok) {
        throw new IntervalsRequestError(`Intervals.icu request failed with ${response.status}`, response.status,
            response.headers.get('retry-after'), 'provider_request_failed');
    }
    return response.json();
}

async function getConnectedIntervalsAccount(slugValue) {
    const slug = normalizeSlug(slugValue);
    if (!isIntervalsSlugEnabled(slug)) {
        throw new IntervalsRequestError('Intervals.icu is not enabled for this user', 404, 0, 'provider_not_enabled');
    }
    const connection = await getConnectionStore().findOne({ connection_key: `${PROVIDER}:${slug}` });
    if (!connection || connection.connection_status !== 'connected' || connection.needs_reconnect) {
        throw new IntervalsRequestError('Intervals.icu connection required', 401, 0, 'reconnect_required');
    }
    if (connection.sync_retry_at && new Date(connection.sync_retry_at).getTime() > Date.now()) {
        throw new IntervalsRequestError('Intervals.icu requests are waiting for rate-limit backoff', 429, 0, 'rate_limited');
    }
    return connection;
}

async function fetchIntervalsMap(connection, activityId) {
    let mapPayload;
    try {
        mapPayload = await intervalsFetchJson(connection, `/activity/${encodeURIComponent(activityId)}/map`);
    } catch (error) {
        if (error.status !== 404) throw error;
        mapPayload = { latlngs: [] };
    }
    const update = transformIntervalsMap(mapPayload);
    const filter = {
        user_slug: connection.user_slug,
        intervals_activity_id: String(activityId)
    };
    const existing = await getIntervalsActivityStore().findOne(filter);
    if (existing && existing.stream_data) {
        update.stream_data = Object.assign({}, existing.stream_data, update.stream_data);
        update.stream_keys = Array.from(new Set([...(existing.stream_keys || []), ...(update.stream_keys || [])]));
    }
    await getIntervalsActivityStore().updateOne(filter, update);
    return update;
}

async function fetchIntervalsActivityDetail(slugValue, activityId) {
    const connection = await getConnectedIntervalsAccount(slugValue);
    const payload = await intervalsFetchJson(connection, `/activity/${encodeURIComponent(activityId)}`, { intervals: 'true' });
    const transformed = transformIntervalsActivity(connection.user_slug, connection.provider_athlete_id, payload, { detail: true });
    if (!transformed || transformed.intervals_activity_id !== String(activityId)) {
        throw new IntervalsRequestError('Intervals.icu returned an unusable activity', 422, 0, 'invalid_activity');
    }
    await getIntervalsActivityStore().upsertOne({
        user_slug: connection.user_slug,
        intervals_activity_id: String(activityId)
    }, transformed);
    return getIntervalsActivityStore().findOne({
        user_slug: connection.user_slug,
        intervals_activity_id: String(activityId)
    });
}

async function fetchIntervalsActivityStreams(slugValue, activityId) {
    const connection = await getConnectedIntervalsAccount(slugValue);
    let payload;
    try {
        payload = await intervalsFetchJson(connection, `/activity/${encodeURIComponent(activityId)}/streams.json`);
    } catch (error) {
        if (error.status !== 404) throw error;
        payload = [];
    }
    const update = transformIntervalsStreams(payload);
    await getIntervalsActivityStore().updateOne({
        user_slug: connection.user_slug,
        intervals_activity_id: String(activityId)
    }, update);
    return getIntervalsActivityStore().findOne({
        user_slug: connection.user_slug,
        intervals_activity_id: String(activityId)
    });
}

async function recomputeIntervalsKpis(slugValue) {
    const slug = normalizeSlug(slugValue);
    const activityStore = getIntervalsActivityStore();
    const snapshotStore = getIntervalsKpiStore();
    const activities = (await activityStore.find({ user_slug: slug }, { sort: { start_date: 1 } }))
        .filter((activity) => activity.dedupe_hidden !== true);
    const snapshots = buildKpiSnapshots(slug, activities, {
        idPrefix: PROVIDER,
        latestActivityId: (activity) => String(activity.intervals_activity_id || activity.id || '') || undefined
    });
    const activeIds = new Set(snapshots.map((snapshot) => snapshot.id));
    for (const snapshot of snapshots) {
        await snapshotStore.upsertOne({ id: snapshot.id }, snapshot);
    }
    for (const snapshot of await snapshotStore.find({ user_slug: slug })) {
        if (!activeIds.has(snapshot.id)) {
            await snapshotStore.deleteOne({ id: snapshot.id });
        }
    }
    return snapshots;
}

async function listAllActivities(connection) {
    const payload = await intervalsFetchJson(connection, '/athlete/0/activities', {
        oldest: getIntervalsConfig().syncOldest,
        limit: MAX_LIST_ACTIVITIES
    });
    return Array.isArray(payload) ? payload : [];
}

async function performIntervalsSync(connection) {
    const connectionStore = getConnectionStore();
    const activityStore = getIntervalsActivityStore();
    const slug = connection.user_slug;
    await connectionStore.updateOne({ connection_key: connection.connection_key }, {
        sync_status: 'syncing', sync_error: '', sync_progress: { phase: 'listing', processed: 0 }
    });
    try {
        const providerActivities = await listAllActivities(connection);
        const eligible = providerActivities.filter(isEligibleIntervalsActivity);
        const providerListComplete = providerActivities.length < MAX_LIST_ACTIVITIES;
        const providerIds = new Set(eligible.map((activity) => String(activity.id)));
        let inserted = 0;
        let updated = 0;
        for (let index = 0; index < eligible.length; index += 1) {
            const payload = eligible[index];
            const filter = { user_slug: slug, intervals_activity_id: String(payload.id) };
            const exists = await activityStore.findOne(filter);
            const transformed = transformIntervalsActivity(slug, connection.provider_athlete_id, payload);
            if (exists && exists.intervals_metrics && transformed.intervals_metrics) {
                transformed.intervals_metrics = Object.assign({}, exists.intervals_metrics, transformed.intervals_metrics);
            }
            await activityStore.upsertOne(filter, transformed);
            exists ? updated += 1 : inserted += 1;
            if (index % 100 === 0 || index === eligible.length - 1) {
                await connectionStore.updateOne({ connection_key: connection.connection_key }, {
                    sync_progress: { phase: 'summaries', processed: index + 1, total: eligible.length }
                });
            }
        }

        let deleted = 0;
        if (providerListComplete) {
            for (const stored of await activityStore.find({ user_slug: slug })) {
                if (stored.import_source !== 'strava_export'
                    && stored.provider !== 'strava_export'
                    && !providerIds.has(String(stored.intervals_activity_id))) {
                    await activityStore.deleteOne({ activity_key: stored.activity_key });
                    deleted += 1;
                }
            }
        }

        let mapsHydrated = 0;
        const storedActivities = (await activityStore.find({ user_slug: slug }, { sort: { start_date: -1 } }))
            .filter((activity) => activity.import_source !== 'strava_export' && activity.provider !== 'strava_export');
        for (let index = 0; index < storedActivities.length; index += 1) {
            const activity = storedActivities[index];
            if (!activity.map_fetched_at) {
                await fetchIntervalsMap(connection, activity.intervals_activity_id);
                mapsHydrated += 1;
            }
            if (index < 12 && !activity.detail_fetched_at) {
                await fetchIntervalsActivityDetail(slug, activity.intervals_activity_id);
            }
            if (index < 12 && !activity.stream_fetched_at) {
                await fetchIntervalsActivityStreams(slug, activity.intervals_activity_id);
            }
            await connectionStore.updateOne({ connection_key: connection.connection_key }, {
                sync_progress: {
                    phase: 'maps', processed: index + 1, total: storedActivities.length,
                    last_activity_id: activity.intervals_activity_id
                }
            });
        }

        const deduplication = await reconcileDuplicateActivitiesForSlug(slug, activityStore);
        await recomputeIntervalsKpis(slug);
        const completedAt = new Date();
        const result = { provider: PROVIDER, slug, fetched: providerActivities.length, eligible: eligible.length,
            inserted, updated, deleted, mapsHydrated, deduplication,
            deletionReconciliationSkipped: !providerListComplete, completedAt };
        await connectionStore.updateOne({ connection_key: connection.connection_key }, {
            last_sync: completedAt,
            last_successful_sync_at: completedAt,
            sync_status: 'idle',
            sync_error: '',
            sync_retry_at: null,
            sync_progress: { phase: 'complete', processed: eligible.length, total: eligible.length },
            total_activities: deduplication.visibleRecords,
            backfill_complete: providerListComplete
        });
        return result;
    } catch (error) {
        await connectionStore.updateOne({ connection_key: connection.connection_key }, {
            sync_status: error.status === 401 ? 'reconnect_required' : 'error',
            sync_error: error.message,
            sync_retry_at: error.status === 429
                ? new Date(Date.now() + Math.max(60000, Number(error.retryAfterSeconds || 0) * 1000))
                : null
        });
        throw error;
    }
}

async function syncIntervalsActivities(slugValue) {
    const slug = normalizeSlug(slugValue);
    if (activeSyncs.has(slug)) {
        return activeSyncs.get(slug);
    }
    const promise = getConnectedIntervalsAccount(slug).then(performIntervalsSync).finally(() => activeSyncs.delete(slug));
    activeSyncs.set(slug, promise);
    return promise;
}

async function reconcileIntervalsActivity(slugValue, activityId) {
    if (!activityId) {
        return syncIntervalsActivities(slugValue);
    }
    const slug = normalizeSlug(slugValue);
    const connection = await getConnectedIntervalsAccount(slug);
    try {
        const detail = await fetchIntervalsActivityDetail(slug, String(activityId));
        await fetchIntervalsMap(connection, String(activityId));
        await recomputeIntervalsKpis(slug);
        return detail;
    } catch (error) {
        if (error.status === 404) {
            await getIntervalsActivityStore().deleteOne({ user_slug: slug, intervals_activity_id: String(activityId) });
            await recomputeIntervalsKpis(slug);
            return null;
        }
        throw error;
    }
}

async function reconcileRecentIntervalsActivities(slugValue, daysValue) {
    const slug = normalizeSlug(slugValue);
    const connection = await getConnectedIntervalsAccount(slug);
    const days = Math.min(31, Math.max(1, Number(daysValue || 14)));
    const oldest = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const payload = await intervalsFetchJson(connection, '/athlete/0/activities', { oldest, limit: 1000 });
    const activities = (Array.isArray(payload) ? payload : []).filter(isEligibleIntervalsActivity);
    for (const activity of activities) {
        const transformed = transformIntervalsActivity(slug, connection.provider_athlete_id, activity);
        const filter = { user_slug: slug, intervals_activity_id: transformed.intervals_activity_id };
        const existing = await getIntervalsActivityStore().findOne(filter);
        if (existing && existing.intervals_metrics && transformed.intervals_metrics) {
            transformed.intervals_metrics = Object.assign({}, existing.intervals_metrics, transformed.intervals_metrics);
        }
        await getIntervalsActivityStore().upsertOne(filter, transformed);
        if (!existing || !existing.map_fetched_at) {
            await fetchIntervalsMap(connection, transformed.intervals_activity_id);
        }
    }
    await recomputeIntervalsKpis(slug);
    return { provider: PROVIDER, slug, reconciled: activities.length, oldest };
}

module.exports = {
    IntervalsRequestError,
    getIntervalsActivityStore,
    getIntervalsKpiStore,
    isHiddenIntervalsActivity,
    isEligibleIntervalsActivity,
    transformIntervalsActivity,
    transformIntervalsMap,
    transformIntervalsStreams,
    intervalsFetchJson,
    fetchIntervalsActivityDetail,
    fetchIntervalsActivityStreams,
    recomputeIntervalsKpis,
    syncIntervalsActivities,
    reconcileIntervalsActivity,
    reconcileRecentIntervalsActivities
};
