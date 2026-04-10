const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');
const getActivityModel = require('../models/activity');
const { getFrontendUserBySlug } = require('../frontend_user_configs');
const { enrichActivityLocation } = require('./location_geocode');
const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';
const SYNC_OVERLAP_MS = 24 * 60 * 60 * 1000;

function getUserStore() {
    return isMongoConnected() ? wrapModel(getUserModel()) : memoryStore.users;
}

function getActivityStore() {
    return isMongoConnected() ? wrapModel(getActivityModel()) : memoryStore.activities;
}

function getStorageLabel() {
    return isMongoConnected() ? 'MongoDB' : 'memory';
}

function createUserTokenRequestPayload(user) {
    return {
        client_id: user.client_id,
        client_secret: user.client_secret,
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
    return compactObject({
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
}

function transformDetailedActivity(user, activity) {
    return Object.assign(transformSummaryActivity(user, activity), {
        segment_efforts: normalizeArray(activity.segment_efforts, normalizeSegmentEffort),
        laps: normalizeArray(activity.laps, normalizeLap),
        splits_metric: normalizeArray(activity.splits_metric, normalizeSplit),
        splits_standard: normalizeArray(activity.splits_standard, normalizeSplit),
        best_efforts: normalizeArray(activity.best_efforts, normalizeSegmentEffort),
        detail_fetched_at: new Date()
    });
}

function getTokenUpdate(tokenData) {
    return {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null
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

    const tokenResponse = await fetch(STRAVA_AUTH_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(createUserTokenRequestPayload(user))
    });

    if (!tokenResponse.ok) {
        throw new Error(`Strava token refresh failed with ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const tokenUpdate = getTokenUpdate(tokenData);
    const updatedUser = await userStore.updateOne({ slug: user.slug }, tokenUpdate);
    return updatedUser || Object.assign({}, user, tokenUpdate);
}

async function ensureUserForSync(slug) {
    const normalizedSlug = String(slug || '').toLowerCase();
    const userStore = getUserStore();
    const existingUser = await userStore.findOne({ slug: normalizedSlug });
    if (existingUser) {
        return existingUser;
    }

    const frontendUser = getFrontendUserBySlug(normalizedSlug);
    if (!frontendUser) {
        return null;
    }

    const tokenResponse = await fetch(STRAVA_AUTH_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(createUserTokenRequestPayload(frontendUser))
    });

    if (!tokenResponse.ok) {
        throw new Error(`Unable to auto-provision user ${normalizedSlug}; Strava authorization failed with ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const tokenUpdate = getTokenUpdate(tokenData);
    const createdUser = await userStore.upsertOne({ slug: normalizedSlug }, Object.assign({}, frontendUser, tokenUpdate));
    console.log('[Strava User Sync]', {
        action: 'auto-provisioned',
        user: normalizedSlug,
        storage: getStorageLabel()
    });
    return createdUser || Object.assign({}, frontendUser, tokenUpdate);
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
        throw new Error(`Strava request failed with ${response.status}`);
    }
    return response.json();
}

async function fetchActivityDetailPayload(accessToken, activityId) {
    return stravaFetchJson(`/activities/${activityId}`, accessToken, {
        include_all_efforts: 'true'
    });
}

async function fetchActivityDetail(user, activityId) {
    const activityStore = getActivityStore();
    const authedUser = await refreshUserAccessToken(user);
    const activity = await fetchActivityDetailPayload(authedUser.access_token, activityId);
    const storedActivity = transformDetailedActivity(authedUser, activity);
    await activityStore.upsertOne({ strava_id: Number(activityId) }, storedActivity);
    const cached = await activityStore.findOne({ strava_id: Number(activityId) });
    return enrichActivityLocation(activityStore, cached || storedActivity).catch(function () {
        return cached || storedActivity;
    });
}

async function fetchActivityStreams(user, activityId) {
    const activityStore = getActivityStore();
    const authedUser = await refreshUserAccessToken(user);
    const streamData = await stravaFetchJson(`/activities/${activityId}/streams`, authedUser.access_token, {
        keys: 'latlng,velocity_smooth,time',
        key_by_type: 'true',
        resolution: 'medium',
        series_type: 'time'
    });
    const streamUpdate = {
        stream_resolution: 'medium',
        stream_series_type: 'time',
        stream_latlng: Array.isArray(streamData && streamData.latlng && streamData.latlng.data) ? streamData.latlng.data : [],
        stream_velocity_smooth: Array.isArray(streamData && streamData.velocity_smooth && streamData.velocity_smooth.data) ? streamData.velocity_smooth.data : [],
        stream_time: Array.isArray(streamData && streamData.time && streamData.time.data) ? streamData.time.data : [],
        stream_fetched_at: new Date()
    };
    await activityStore.upsertOne({ strava_id: Number(activityId) }, streamUpdate);
    const cached = await activityStore.findOne({ strava_id: Number(activityId) });
    return cached ? {
        strava_id: cached.strava_id,
        stream_resolution: cached.stream_resolution,
        stream_series_type: cached.stream_series_type,
        stream_latlng: cached.stream_latlng || [],
        stream_velocity_smooth: cached.stream_velocity_smooth || [],
        stream_time: cached.stream_time || [],
        stream_fetched_at: cached.stream_fetched_at || streamUpdate.stream_fetched_at
    } : Object.assign({ strava_id: Number(activityId) }, streamUpdate);
}

async function fetchActivitySummaries(accessToken, numPages, afterEpochSeconds) {
    const activities = [];
    for (let page = 1; page <= numPages; page += 1) {
        const pageActivities = await stravaFetchJson('/athlete/activities', accessToken, {
            per_page: 200,
            page: page,
            after: afterEpochSeconds
        });
        if (!Array.isArray(pageActivities) || !pageActivities.length) {
            break;
        }
        activities.push(...pageActivities);
        if (pageActivities.length < 200) {
            break;
        }
    }
    return activities;
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

async function syncUserActivities(user) {
    const userStore = getUserStore();
    const activityStore = getActivityStore();
    const authedUser = await refreshUserAccessToken(user);
    const latestStoredActivity = await activityStore.findOne({ user_slug: authedUser.slug }, {
        sort: { start_date: -1 }
    });
    const afterEpochSeconds = getAfterEpochSeconds(latestStoredActivity);
    const numPages = Number(authedUser.num_pages || authedUser.pages || 1);
    const summaryActivities = await fetchActivitySummaries(authedUser.access_token, numPages, afterEpochSeconds);
    const storedActivities = summaryActivities.map(function (summaryActivity) {
        return transformSummaryActivity(authedUser, summaryActivity);
    });

    const upsertSummary = await activityStore.bulkUpsertActivities(storedActivities);
    const recordsInserted = Number(upsertSummary && upsertSummary.insertedCount) || 0;
    const recordsUpdated = Number(upsertSummary && upsertSummary.updatedCount) || 0;
    const stravaSummaryFetchedCount = summaryActivities.length;
    const stravaDetailFetchedCount = 0;
    const stravaRecordsPulled = recordsInserted;
    const storedActivityCount = await activityStore.count({ user_slug: authedUser.slug });
    const storage = getStorageLabel();
    const lastSync = new Date();

    console.log('[Strava Sync]', {
        user: authedUser.slug,
        source: 'Strava API',
        storage: storage,
        after: afterEpochSeconds || null,
        stravaSummaryFetchedCount: stravaSummaryFetchedCount,
        stravaDetailFetchedCount: stravaDetailFetchedCount,
        stravaRecordsPulled: stravaRecordsPulled,
        recordsInserted: recordsInserted,
        recordsUpdated: recordsUpdated,
        storedActivityCount: storedActivityCount
    });

    const updatedUser = await userStore.updateOne({ slug: user.slug }, {
        access_token: authedUser.access_token,
        refresh_token: authedUser.refresh_token,
        token_expires: authedUser.token_expires,
        last_sync: lastSync,
        total_activities: storedActivityCount
    });

    return {
        user: updatedUser || Object.assign({}, user, {
            access_token: authedUser.access_token,
            refresh_token: authedUser.refresh_token,
            token_expires: authedUser.token_expires,
            last_sync: lastSync,
            total_activities: storedActivityCount
        }),
        source: 'Strava API',
        storage: storage,
        after: afterEpochSeconds || null,
        recordsInserted: recordsInserted,
        recordsUpdated: recordsUpdated,
        stravaSummaryFetchedCount: stravaSummaryFetchedCount,
        stravaDetailFetchedCount: stravaDetailFetchedCount,
        stravaRecordsPulled: stravaRecordsPulled,
        storedActivityCount: storedActivityCount,
        activitiesSynced: stravaSummaryFetchedCount
    };
}

module.exports = {
    syncUserActivities,
    refreshUserAccessToken,
    ensureUserForSync,
    fetchActivityDetail,
    fetchActivityStreams,
    getUserStore,
    getActivityStore
};
