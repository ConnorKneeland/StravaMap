const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');
const getActivityModel = require('../models/activity');
const getActivityKpiSnapshotModel = require('../models/activity_kpi_snapshot');
const { getUserStravaCredentials } = require('../config/strava');
const {
    ensureKnownUser,
    isUserConnected,
    markReconnectRequired,
    normalizeSlug
} = require('./connection');
const { enrichActivityLocation } = require('./location_geocode');
const { buildKpiSnapshots, extractSportMetrics } = require('../activity_kpis');
const {
    STRAVA_STREAM_REGISTRY,
    normalizeStreamRequest
} = require('../stream_config');
const ActivityTypes = require('../../js/strava_activity_types');
const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';
const SYNC_OVERLAP_MS = 24 * 60 * 60 * 1000;
const STRAVA_PAGE_SIZE = 200;
const MAX_BACKFILL_PAGES = 1000;

class StravaRequestError extends Error {
    constructor(message, status, retryAfterSeconds) {
        super(message);
        this.name = 'StravaRequestError';
        this.status = Number(status || 0);
        this.retryAfterSeconds = Number(retryAfterSeconds || 0);
    }
}

function getUserStore() {
    return isMongoConnected() ? wrapModel(getUserModel()) : memoryStore.users;
}

function getActivityStore() {
    return isMongoConnected() ? wrapModel(getActivityModel()) : memoryStore.activities;
}

function getActivityKpiSnapshotStore() {
    return isMongoConnected() ? wrapModel(getActivityKpiSnapshotModel()) : memoryStore.activityKpiSnapshots;
}

function getStorageLabel() {
    return isMongoConnected() ? 'MongoDB' : 'memory';
}

function createUserTokenRequestPayload(user) {
    const credentials = getUserStravaCredentials(user);
    return {
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: user.refresh_token,
        grant_type: 'refresh_token'
    };
}

function compactObject(object) {
    return Object.entries(object).reduce((result, entry) => {
        if (entry[1] !== undefined) {
            result[entry[0]] = entry[1];
        }
        return result;
    }, {});
}

function normalizeNumber(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeString(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    return String(value);
}

function normalizeBoolean(value) {
    if (value === undefined || value === null) {
        return undefined;
    }
    return Boolean(value);
}

function normalizeLatLng(value) {
    if (!Array.isArray(value) || value.length !== 2) {
        return undefined;
    }
    const pair = value.map(normalizeNumber);
    if (pair.some((coordinate) => coordinate === undefined)) {
        return undefined;
    }
    return pair;
}

function normalizeArray(items, mapper) {
    if (!Array.isArray(items) || !items.length) {
        return undefined;
    }
    const normalized = items.map(function (item) {
        return mapper(item);
    }).filter(Boolean);
    return normalized.length ? normalized : undefined;
}

function normalizeMapFields(map) {
    const mapPayload = map || {};
    return compactObject({
        map_id: normalizeString(mapPayload.id),
        map_polyline: normalizeString(mapPayload.polyline),
        map_resource_state: normalizeNumber(mapPayload.resource_state),
        map_summary_polyline: normalizeString(mapPayload.summary_polyline),
        map_city: normalizeString(mapPayload.city),
        map_state: normalizeString(mapPayload.state),
        map_country: normalizeString(mapPayload.country)
    });
}

function normalizeSplit(split) {
    if (!split || typeof split !== 'object') {
        return null;
    }
    return compactObject({
        distance: normalizeNumber(split.distance),
        elapsed_time: normalizeNumber(split.elapsed_time),
        elevation_difference: normalizeNumber(split.elevation_difference),
        moving_time: normalizeNumber(split.moving_time),
        split: normalizeNumber(split.split),
        average_speed: normalizeNumber(split.average_speed),
        pace_zone: normalizeNumber(split.pace_zone)
    });
}

function normalizeSegment(segment) {
    if (!segment || typeof segment !== 'object') {
        return null;
    }
    return compactObject({
        id: normalizeNumber(segment.id),
        name: normalizeString(segment.name),
        activity_type: normalizeString(segment.activity_type),
        distance: normalizeNumber(segment.distance),
        average_grade: normalizeNumber(segment.average_grade),
        maximum_grade: normalizeNumber(segment.maximum_grade),
        elevation_high: normalizeNumber(segment.elevation_high),
        elevation_low: normalizeNumber(segment.elevation_low),
        start_latlng: normalizeLatLng(segment.start_latlng),
        end_latlng: normalizeLatLng(segment.end_latlng),
        climb_category: normalizeNumber(segment.climb_category),
        city: normalizeString(segment.city),
        state: normalizeString(segment.state),
        country: normalizeString(segment.country)
    });
}

function normalizeSegmentEffort(segmentEffort) {
    if (!segmentEffort || typeof segmentEffort !== 'object') {
        return null;
    }
    return compactObject({
        id: normalizeNumber(segmentEffort.id),
        name: normalizeString(segmentEffort.name),
        elapsed_time: normalizeNumber(segmentEffort.elapsed_time),
        moving_time: normalizeNumber(segmentEffort.moving_time),
        start_date: normalizeString(segmentEffort.start_date),
        start_date_local: normalizeString(segmentEffort.start_date_local),
        distance: normalizeNumber(segmentEffort.distance),
        start_index: normalizeNumber(segmentEffort.start_index),
        end_index: normalizeNumber(segmentEffort.end_index),
        average_cadence: normalizeNumber(segmentEffort.average_cadence),
        average_watts: normalizeNumber(segmentEffort.average_watts),
        max_watts: normalizeNumber(segmentEffort.max_watts),
        weighted_average_watts: normalizeNumber(segmentEffort.weighted_average_watts),
        device_watts: normalizeBoolean(segmentEffort.device_watts),
        segment: normalizeSegment(segmentEffort.segment)
    });
}

function normalizeLap(lap) {
    if (!lap || typeof lap !== 'object') {
        return null;
    }
    return compactObject({
        id: normalizeNumber(lap.id),
        name: normalizeString(lap.name),
        elapsed_time: normalizeNumber(lap.elapsed_time),
        moving_time: normalizeNumber(lap.moving_time),
        start_date: normalizeString(lap.start_date),
        start_date_local: normalizeString(lap.start_date_local),
        distance: normalizeNumber(lap.distance),
        start_index: normalizeNumber(lap.start_index),
        end_index: normalizeNumber(lap.end_index),
        total_elevation_gain: normalizeNumber(lap.total_elevation_gain),
        average_speed: normalizeNumber(lap.average_speed),
        max_speed: normalizeNumber(lap.max_speed),
        average_cadence: normalizeNumber(lap.average_cadence),
        average_watts: normalizeNumber(lap.average_watts),
        device_watts: normalizeBoolean(lap.device_watts),
        lap_index: normalizeNumber(lap.lap_index),
        split: normalizeNumber(lap.split)
    });
}

function transformSummaryActivity(user, activity) {
    const mapFields = normalizeMapFields(activity.map);
    const transformed = compactObject({
        strava_id: normalizeNumber(activity.id),
        user_id: user._id || user.slug,
        user_slug: user.slug,
        external_id: normalizeString(activity.external_id),
        upload_id: normalizeNumber(activity.upload_id),
        athlete_strava_id: normalizeNumber(activity.athlete && activity.athlete.id),
        athlete_resource_state: normalizeNumber(activity.athlete && activity.athlete.resource_state),
        name: normalizeString(activity.name),
        type: normalizeString(activity.type),
        sport_type: normalizeString(activity.sport_type),
        activity_type_key: ActivityTypes.normalizeActivityTypeKey(activity),
        start_date: normalizeString(activity.start_date),
        start_date_local: normalizeString(activity.start_date_local),
        timezone: normalizeString(activity.timezone),
        utc_offset: normalizeNumber(activity.utc_offset),
        distance: normalizeNumber(activity.distance),
        elapsed_time: normalizeNumber(activity.elapsed_time),
        moving_time: normalizeNumber(activity.moving_time),
        total_elevation_gain: normalizeNumber(activity.total_elevation_gain),
        average_speed: normalizeNumber(activity.average_speed),
        max_speed: normalizeNumber(activity.max_speed),
        average_heartrate: normalizeNumber(activity.average_heartrate),
        max_heartrate: normalizeNumber(activity.max_heartrate),
        elev_high: normalizeNumber(activity.elev_high),
        elev_low: normalizeNumber(activity.elev_low),
        average_cadence: normalizeNumber(activity.average_cadence),
        average_watts: normalizeNumber(activity.average_watts),
        kilojoules: normalizeNumber(activity.kilojoules),
        location_city: normalizeString(activity.location_city),
        location_state: normalizeString(activity.location_state),
        location_country: normalizeString(activity.location_country),
        start_latlng: normalizeLatLng(activity.start_latlng),
        end_latlng: normalizeLatLng(activity.end_latlng),
        summary_polyline: normalizeString((activity.map && activity.map.summary_polyline) || activity.summary_polyline),
        achievement_count: normalizeNumber(activity.achievement_count),
        kudos_count: normalizeNumber(activity.kudos_count),
        comment_count: normalizeNumber(activity.comment_count),
        athlete_count: normalizeNumber(activity.athlete_count),
        photo_count: normalizeNumber(activity.photo_count),
        pr_count: normalizeNumber(activity.pr_count),
        workout_type: normalizeNumber(activity.workout_type),
        average_temp: normalizeNumber(activity.average_temp),
        weighted_average_watts: normalizeNumber(activity.weighted_average_watts),
        device_watts: normalizeBoolean(activity.device_watts),
        has_heartrate: normalizeBoolean(activity.has_heartrate),
        max_watts: normalizeNumber(activity.max_watts),
        suffer_score: normalizeNumber(activity.suffer_score),
        description: normalizeString(activity.description),
        calories: normalizeNumber(activity.calories),
        total_photo_count: normalizeNumber(activity.total_photo_count),
        from_accepted_tag: normalizeBoolean(activity.from_accepted_tag),
        device_name: normalizeString(activity.device_name),
        hide_from_home: normalizeBoolean(activity.hide_from_home),
        ...mapFields
    });
    const sportMetrics = extractSportMetrics(Object.assign({}, activity, transformed));
    if (Object.keys(sportMetrics).length) {
        transformed.sport_metrics = sportMetrics;
    }
    return transformed;
}

function transformDetailedActivity(user, activity) {
    const transformed = Object.assign(transformSummaryActivity(user, activity), {
        segment_efforts: normalizeArray(activity.segment_efforts, normalizeSegmentEffort),
        laps: normalizeArray(activity.laps, normalizeLap),
        splits_metric: normalizeArray(activity.splits_metric, normalizeSplit),
        splits_standard: normalizeArray(activity.splits_standard, normalizeSplit),
        best_efforts: normalizeArray(activity.best_efforts, normalizeSegmentEffort),
        detail_fetched_at: new Date()
    });
    const sportMetrics = extractSportMetrics(Object.assign({}, activity, transformed));
    if (Object.keys(sportMetrics).length) {
        transformed.sport_metrics = sportMetrics;
    }
    return transformed;
}

function getTokenUpdate(tokenData) {
    return {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null,
        connection_status: 'connected',
        needs_reconnect: false,
        sync_error: ''
    };
}

function shouldRefreshToken(user) {
    if (!user || !user.access_token || !user.token_expires) {
        return true;
    }
    const expiresAt = new Date(user.token_expires).getTime();
    return Number.isNaN(expiresAt) || expiresAt <= Date.now() + 60000;
}

async function refreshUserAccessToken(user) {
    const userStore = getUserStore();
    if (!shouldRefreshToken(user)) {
        return user;
    }

    try {
        const tokenResponse = await fetch(STRAVA_AUTH_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(createUserTokenRequestPayload(user))
        });

        if (!tokenResponse.ok) {
            if (tokenResponse.status === 400 || tokenResponse.status === 401) {
                await markReconnectRequired(userStore, user.slug, `Strava token refresh failed with ${tokenResponse.status}`);
            }
            throw new StravaRequestError(
                `Strava token refresh failed with ${tokenResponse.status}`,
                tokenResponse.status,
                tokenResponse.headers && tokenResponse.headers.get('retry-after')
            );
        }

        const tokenData = await tokenResponse.json();
        const tokenUpdate = getTokenUpdate(tokenData);
        const updatedUser = await userStore.updateOne({ slug: user.slug }, tokenUpdate);
        return updatedUser || Object.assign({}, user, tokenUpdate);
    } catch (error) {
        if (error instanceof StravaRequestError) {
            throw error;
        }
        throw new StravaRequestError(`Strava token refresh failed: ${error.message}`, 0, 0);
    }
}

async function ensureUserForSync(slug) {
    const normalizedSlug = normalizeSlug(slug);
    if (!normalizedSlug) {
        return null;
    }
    const userStore = getUserStore();
    return ensureKnownUser(userStore, normalizedSlug);
}

async function stravaFetchJson(path, accessToken, params) {
    const url = new URL(`${STRAVA_API_BASE_URL}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    const response = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json, text/plain, */*',
            Authorization: `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        throw new StravaRequestError(
            `Strava request failed with ${response.status}`,
            response.status,
            response.headers && response.headers.get('retry-after')
        );
    }
    return response.json();
}

async function bindUserToAthlete(user, athleteIdValue) {
    const athleteId = Number(athleteIdValue);
    if (!Number.isFinite(athleteId) || athleteId <= 0) {
        throw new Error(`Strava did not return a valid athlete for slug ${user.slug}`);
    }
    if (user.strava_id != null && Number(user.strava_id) !== athleteId) {
        throw new Error(`Strava athlete mismatch for slug ${user.slug}; admin override required`);
    }
    const userStore = getUserStore();
    const existingOwner = await userStore.findOne({ strava_id: athleteId });
    if (existingOwner && existingOwner.slug !== user.slug) {
        throw new Error(`Strava athlete ${athleteId} is already bound to slug ${existingOwner.slug}; admin override required`);
    }
    if (user.strava_id == null || user.connection_status !== 'connected') {
        const updated = await userStore.updateOne({ slug: user.slug }, {
            strava_id: athleteId,
            connection_status: 'connected',
            needs_reconnect: false
        });
        return updated || Object.assign({}, user, { strava_id: athleteId });
    }
    return user;
}

async function assertActivitiesBelongToUser(user, activities) {
    const athleteIds = Array.from(new Set((activities || [])
        .map((activity) => Number(activity && activity.athlete && activity.athlete.id))
        .filter((athleteId) => Number.isFinite(athleteId) && athleteId > 0)));
    if (athleteIds.length > 1) {
        throw new Error(`Strava returned activities for multiple athletes while syncing ${user.slug}`);
    }
    if (!athleteIds.length) {
        return user;
    }
    return bindUserToAthlete(user, athleteIds[0]);
}

async function assertNoCrossSlugActivityOverwrite(userSlug, activities) {
    const activityIds = (activities || []).map((activity) => Number(activity.strava_id)).filter(Boolean);
    if (!activityIds.length) {
        return;
    }
    const existingActivities = await getActivityStore().find({ strava_id: { $in: activityIds } });
    const conflict = existingActivities.find((activity) => activity.user_slug !== userSlug);
    if (conflict) {
        throw new Error(`Activity ${conflict.strava_id} belongs to slug ${conflict.user_slug}; cross-slug write blocked`);
    }
}

async function fetchActivityDetailPayload(accessToken, activityId) {
    return stravaFetchJson(`/activities/${activityId}`, accessToken, {
        include_all_efforts: 'true'
    });
}

async function fetchActivityDetail(user, activityId) {
    const activityStore = getActivityStore();
    let authedUser = await refreshUserAccessToken(user);
    const activity = await fetchActivityDetailPayload(authedUser.access_token, activityId);
    authedUser = await assertActivitiesBelongToUser(authedUser, [activity]);
    const storedActivity = transformDetailedActivity(authedUser, activity);
    await assertNoCrossSlugActivityOverwrite(authedUser.slug, [storedActivity]);
    await activityStore.upsertOne({ strava_id: Number(activityId), user_slug: authedUser.slug }, storedActivity);
    const cached = await activityStore.findOne({ strava_id: Number(activityId), user_slug: authedUser.slug });
    return enrichActivityLocation(activityStore, cached || storedActivity).catch(function () {
        return cached || storedActivity;
    });
}

function extractStreamPayload(streamData, key) {
    const stream = streamData && streamData[key];
    if (stream && Array.isArray(stream.data)) {
        return stream.data;
    }
    return Array.isArray(stream) ? stream : [];
}

function extractStreamMetadata(streamData, key) {
    const stream = streamData && streamData[key];
    if (!stream || typeof stream !== 'object' || Array.isArray(stream)) {
        return null;
    }
    return compactObject({
        original_size: stream.original_size,
        resolution: stream.resolution,
        series_type: stream.series_type
    });
}

function getStoredStreamData(activity) {
    const streams = activity && activity.stream_data && typeof activity.stream_data === 'object'
        ? Object.assign({}, activity.stream_data)
        : {};
    if (Array.isArray(activity && activity.stream_latlng) && activity.stream_latlng.length && !streams.latlng) {
        streams.latlng = activity.stream_latlng;
    }
    if (Array.isArray(activity && activity.stream_velocity_smooth) && activity.stream_velocity_smooth.length && !streams.velocity_smooth) {
        streams.velocity_smooth = activity.stream_velocity_smooth;
    }
    if (Array.isArray(activity && activity.stream_time) && activity.stream_time.length && !streams.time) {
        streams.time = activity.stream_time;
    }
    return streams;
}

function mergeUniqueStrings(left, right) {
    return Array.from(new Set([...(left || []), ...(right || [])].map((value) => String(value || '').trim()).filter(Boolean)));
}

async function fetchActivityStreams(user, activityId, options) {
    const activityStore = getActivityStore();
    const authedUser = await refreshUserAccessToken(user);
    const streamRequest = normalizeStreamRequest(options);
    const existingActivity = await activityStore.findOne({ strava_id: Number(activityId), user_slug: authedUser.slug });
    const streamData = await stravaFetchJson(`/activities/${activityId}/streams`, authedUser.access_token, {
        keys: streamRequest.keys.join(','),
        key_by_type: 'true',
        resolution: streamRequest.resolution,
        series_type: streamRequest.seriesType
    });
    const streams = {};
    const streamMetadata = {};
    Object.keys(STRAVA_STREAM_REGISTRY).forEach((key) => {
        const values = extractStreamPayload(streamData, key);
        if (values.length) {
            streams[key] = values;
        }
        const metadata = extractStreamMetadata(streamData, key);
        if (metadata) {
            streamMetadata[key] = metadata;
        }
    });
    const canMergeExisting = existingActivity
        && existingActivity.stream_resolution === streamRequest.resolution
        && existingActivity.stream_series_type === streamRequest.seriesType;
    const mergedStreams = Object.assign({}, canMergeExisting ? getStoredStreamData(existingActivity) : {}, streams);
    const mergedMetadata = Object.assign({}, canMergeExisting && existingActivity.stream_metadata ? existingActivity.stream_metadata : {}, streamMetadata);
    const mergedRequestedKeys = mergeUniqueStrings(canMergeExisting && existingActivity ? existingActivity.stream_requested_keys : [], streamRequest.keys);
    const mergedStreamKeys = mergeUniqueStrings(canMergeExisting && existingActivity ? existingActivity.stream_keys : [], Object.keys(mergedStreams));
    const streamUpdate = {
        stream_resolution: streamRequest.resolution,
        stream_series_type: streamRequest.seriesType,
        stream_data: mergedStreams,
        stream_keys: mergedStreamKeys,
        stream_requested_keys: mergedRequestedKeys,
        stream_metadata: mergedMetadata,
        stream_latlng: mergedStreams.latlng || [],
        stream_velocity_smooth: mergedStreams.velocity_smooth || [],
        stream_time: mergedStreams.time || [],
        stream_fetched_at: new Date()
    };
    await activityStore.upsertOne({ strava_id: Number(activityId), user_slug: authedUser.slug }, streamUpdate);
    const cached = await activityStore.findOne({ strava_id: Number(activityId), user_slug: authedUser.slug });
    return cached ? {
        strava_id: cached.strava_id,
        stream_resolution: cached.stream_resolution,
        stream_series_type: cached.stream_series_type,
        stream_data: cached.stream_data || {},
        stream_keys: cached.stream_keys || [],
        stream_requested_keys: cached.stream_requested_keys || [],
        stream_metadata: cached.stream_metadata || {},
        stream_latlng: cached.stream_latlng || [],
        stream_velocity_smooth: cached.stream_velocity_smooth || [],
        stream_time: cached.stream_time || [],
        stream_fetched_at: cached.stream_fetched_at || streamUpdate.stream_fetched_at
    } : Object.assign({ strava_id: Number(activityId) }, streamUpdate);
}

async function fetchActivitySummaryPage(accessToken, page, afterEpochSeconds) {
    const pageActivities = await stravaFetchJson('/athlete/activities', accessToken, {
        per_page: STRAVA_PAGE_SIZE,
        page,
        after: afterEpochSeconds
    });
    return Array.isArray(pageActivities) ? pageActivities : [];
}

async function recomputeActivityKpiSnapshots(userSlug) {
    const normalizedSlug = String(userSlug || '').toLowerCase();
    const activityStore = getActivityStore();
    const snapshotStore = getActivityKpiSnapshotStore();
    const activities = await activityStore.find({ user_slug: normalizedSlug }, { sort: { start_date: 1 } });
    const snapshots = buildKpiSnapshots(normalizedSlug, activities);
    const activeIds = new Set(snapshots.map((snapshot) => snapshot.id));

    for (const snapshot of snapshots) {
        await snapshotStore.upsertOne({ id: snapshot.id }, snapshot);
    }

    const existingSnapshots = await snapshotStore.find({ user_slug: normalizedSlug });
    for (const snapshot of existingSnapshots) {
        if (!activeIds.has(snapshot.id)) {
            await snapshotStore.deleteOne({ id: snapshot.id });
        }
    }

    return snapshots;
}

function getAfterEpochSeconds(activity) {
    if (!activity || !activity.start_date) {
        return undefined;
    }
    const timestamp = new Date(activity.start_date).getTime();
    if (Number.isNaN(timestamp)) {
        return undefined;
    }
    return Math.max(0, Math.floor((timestamp - SYNC_OVERLAP_MS) / 1000));
}

const activeUserSyncs = new Map();

function getRateLimitRetryDate(user, error) {
    const attempts = Number(user.sync_backoff_attempts || 0) + 1;
    const retryAfterMs = Number(error.retryAfterSeconds || 0) * 1000;
    const exponentialMs = Math.min(15 * 60 * 1000, Math.pow(2, Math.min(attempts, 8)) * 30000);
    return {
        attempts,
        retryAt: new Date(Date.now() + Math.max(retryAfterMs, exponentialMs))
    };
}

async function performUserActivitySync(user) {
    const userStore = getUserStore();
    const activityStore = getActivityStore();
    if (!isUserConnected(user)) {
        throw new StravaRequestError(`Strava connection required for ${user.slug}`, 401, 0);
    }
    if (user.sync_retry_at && new Date(user.sync_retry_at).getTime() > Date.now()) {
        throw new StravaRequestError(`Strava sync for ${user.slug} is waiting for rate-limit backoff`, 429, 0);
    }

    await userStore.updateOne({ slug: user.slug }, {
        sync_status: 'syncing',
        sync_error: ''
    });

    let authedUser = user;
    try {
        authedUser = await refreshUserAccessToken(user);
        const isBackfill = authedUser.backfill_complete !== true;
        const latestStoredActivity = isBackfill ? null : await activityStore.findOne({ user_slug: authedUser.slug }, {
            sort: { start_date: -1 }
        });
        const afterEpochSeconds = isBackfill ? undefined : getAfterEpochSeconds(latestStoredActivity);
        const priorProgress = authedUser.sync_progress && typeof authedUser.sync_progress === 'object'
            ? authedUser.sync_progress
            : {};
        let page = isBackfill && priorProgress.mode === 'backfill'
            ? Math.max(1, Number(priorProgress.next_page || 1))
            : 1;
        let backfillComplete = !isBackfill;
        let recordsInserted = 0;
        let recordsUpdated = 0;
        let stravaSummaryFetchedCount = 0;

        for (; page <= MAX_BACKFILL_PAGES; page += 1) {
            const summaryActivities = await fetchActivitySummaryPage(authedUser.access_token, page, afterEpochSeconds);
            authedUser = await assertActivitiesBelongToUser(authedUser, summaryActivities);
            const storedActivities = summaryActivities.map((summaryActivity) => transformSummaryActivity(authedUser, summaryActivity));
            await assertNoCrossSlugActivityOverwrite(authedUser.slug, storedActivities);
            const upsertSummary = await activityStore.bulkUpsertActivities(storedActivities);
            recordsInserted += Number(upsertSummary && upsertSummary.insertedCount) || 0;
            recordsUpdated += Number(upsertSummary && upsertSummary.updatedCount) || 0;
            stravaSummaryFetchedCount += summaryActivities.length;

            await userStore.updateOne({ slug: authedUser.slug }, {
                sync_progress: {
                    mode: isBackfill ? 'backfill' : 'incremental',
                    next_page: page + 1,
                    fetched: Number(priorProgress.fetched || 0) + stravaSummaryFetchedCount,
                    updated_at: new Date()
                }
            });

            if (summaryActivities.length < STRAVA_PAGE_SIZE) {
                backfillComplete = true;
                break;
            }
        }

        if (page > MAX_BACKFILL_PAGES && !backfillComplete) {
            throw new Error(`Strava backfill exceeded ${MAX_BACKFILL_PAGES} pages`);
        }
        if (authedUser.strava_id == null) {
            const athlete = await stravaFetchJson('/athlete', authedUser.access_token);
            authedUser = await bindUserToAthlete(authedUser, athlete && athlete.id);
        }

        const storedActivityCount = await activityStore.count({ user_slug: authedUser.slug });
        const activityKpiSnapshots = await recomputeActivityKpiSnapshots(authedUser.slug);
        const storage = getStorageLabel();
        const lastSync = new Date();
        const updatedUser = await userStore.updateOne({ slug: user.slug }, {
            access_token: authedUser.access_token,
            refresh_token: authedUser.refresh_token,
            token_expires: authedUser.token_expires,
            last_sync: lastSync,
            last_successful_sync_at: lastSync,
            total_activities: storedActivityCount,
            connection_status: 'connected',
            needs_reconnect: false,
            sync_status: 'ready',
            sync_error: '',
            sync_retry_at: null,
            sync_backoff_attempts: 0,
            backfill_complete: backfillComplete,
            sync_progress: {
                mode: isBackfill ? 'backfill' : 'incremental',
                complete: true,
                next_page: null,
                fetched: stravaSummaryFetchedCount,
                updated_at: lastSync
            }
        });

        console.log('[Strava Sync]', {
            user: authedUser.slug,
            mode: isBackfill ? 'backfill' : 'incremental',
            source: 'Strava API',
            storage,
            after: afterEpochSeconds || null,
            stravaSummaryFetchedCount,
            recordsInserted,
            recordsUpdated,
            storedActivityCount,
            activityKpiSnapshotCount: activityKpiSnapshots.length
        });

        return {
            user: updatedUser || authedUser,
            source: 'Strava API',
            storage,
            mode: isBackfill ? 'backfill' : 'incremental',
            after: afterEpochSeconds || null,
            recordsInserted,
            recordsUpdated,
            stravaSummaryFetchedCount,
            stravaDetailFetchedCount: 0,
            stravaRecordsPulled: recordsInserted,
            storedActivityCount,
            activityKpiSnapshotCount: activityKpiSnapshots.length,
            activitiesSynced: stravaSummaryFetchedCount,
            backfillComplete
        };
    } catch (error) {
        const latestUser = await userStore.findOne({ slug: user.slug }) || authedUser || user;
        if (error instanceof StravaRequestError && error.status === 429) {
            const retry = getRateLimitRetryDate(latestUser, error);
            await userStore.updateOne({ slug: user.slug }, {
                sync_status: 'rate_limited',
                sync_error: error.message,
                sync_retry_at: retry.retryAt,
                sync_backoff_attempts: retry.attempts
            });
        } else if (latestUser.needs_reconnect || (error instanceof StravaRequestError && [400, 401].includes(error.status))) {
            await markReconnectRequired(userStore, user.slug, error.message);
        } else {
            await userStore.updateOne({ slug: user.slug }, {
                sync_status: 'error',
                sync_error: error && error.message ? error.message : 'Unknown sync error'
            });
        }
        throw error;
    }
}

async function syncUserActivities(user) {
    const slug = normalizeSlug(user && user.slug);
    if (!slug) {
        throw new Error('A valid user slug is required for sync');
    }
    if (activeUserSyncs.has(slug)) {
        return activeUserSyncs.get(slug);
    }
    const syncPromise = performUserActivitySync(user).finally(() => {
        activeUserSyncs.delete(slug);
    });
    activeUserSyncs.set(slug, syncPromise);
    return syncPromise;
}

module.exports = {
    syncUserActivities,
    refreshUserAccessToken,
    ensureUserForSync,
    fetchActivityDetail,
    fetchActivityStreams,
    bindUserToAthlete,
    recomputeActivityKpiSnapshots,
    getUserStore,
    getActivityStore,
    getActivityKpiSnapshotStore
};
