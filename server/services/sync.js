const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');
const getActivityModel = require('../models/activity');
const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';

function getUserStore() {
    return isMongoConnected() ? wrapModel(getUserModel()) : memoryStore.users;
}

function getActivityStore() {
    return isMongoConnected() ? wrapModel(getActivityModel()) : memoryStore.activities;
}

function transformActivity(user, activity) {
    return {
        strava_id: activity.id,
        user_id: user._id || user.slug,
        user_slug: user.slug,
        name: activity.name,
        type: activity.type,
        sport_type: activity.sport_type,
        start_date: activity.start_date,
        start_date_local: activity.start_date_local || null,
        timezone: activity.timezone || null,
        distance: activity.distance,
        elapsed_time: activity.elapsed_time,
        moving_time: activity.moving_time,
        average_speed: activity.average_speed,
        max_speed: activity.max_speed,
        average_heartrate: activity.average_heartrate,
        max_heartrate: activity.max_heartrate,
        elev_high: activity.elev_high,
        elev_low: activity.elev_low,
        total_elevation_gain: activity.total_elevation_gain,
        average_cadence: activity.average_cadence,
        average_watts: activity.average_watts,
        kilojoules: activity.kilojoules,
        location_city: activity.location_city || null,
        location_state: activity.location_state || null,
        location_country: activity.location_country || null,
        start_latlng: activity.start_latlng,
        end_latlng: activity.end_latlng,
        summary_polyline: activity.map && activity.map.summary_polyline ? activity.map.summary_polyline : null
    };
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
        body: JSON.stringify({
            client_id: user.client_id,
            client_secret: user.client_secret,
            refresh_token: user.refresh_token,
            grant_type: 'refresh_token'
        })
    });

    if (!tokenResponse.ok) {
        throw new Error(`Strava token refresh failed with ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const tokenUpdate = getTokenUpdate(tokenData);
    const updatedUser = await userStore.updateOne({ slug: user.slug }, tokenUpdate);
    return updatedUser || Object.assign({}, user, tokenUpdate);
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

async function fetchActivityDetail(user, activityId) {
    const activityStore = getActivityStore();
    const authedUser = await refreshUserAccessToken(user);
    const activity = await stravaFetchJson(`/activities/${activityId}`, authedUser.access_token);
    const storedActivity = Object.assign(transformActivity(authedUser, activity), {
        detail_fetched_at: new Date()
    });
    await activityStore.upsertOne({ strava_id: Number(activityId) }, storedActivity);
    const cached = await activityStore.findOne({ strava_id: Number(activityId) });
    return cached || storedActivity;
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

async function syncUserActivities(user) {
    const userStore = getUserStore();
    const activityStore = getActivityStore();
    const authedUser = await refreshUserAccessToken(user);
    const activities = [];
    const numPages = Number(authedUser.num_pages || authedUser.pages || 1);

    for (let page = 1; page <= numPages; page += 1) {
        const activitiesResponse = await fetch(`${STRAVA_API_BASE_URL}/athlete/activities?access_token=${authedUser.access_token}&per_page=200&page=${page}`);
        if (!activitiesResponse.ok) {
            throw new Error(`Strava activities sync failed with ${activitiesResponse.status}`);
        }
        const pageActivities = await activitiesResponse.json();
        if (!Array.isArray(pageActivities) || !pageActivities.length) {
            break;
        }
        activities.push(...pageActivities.map((activity) => transformActivity(authedUser, activity)));
        if (pageActivities.length < 200) {
            break;
        }
    }

    await activityStore.bulkUpsertActivities(activities);
    const updatedUser = await userStore.updateOne({ slug: user.slug }, {
        access_token: authedUser.access_token,
        refresh_token: authedUser.refresh_token,
        token_expires: authedUser.token_expires,
        last_sync: new Date(),
        total_activities: activities.length
    });

    return {
        user: updatedUser || Object.assign({}, user, {
            access_token: authedUser.access_token,
            refresh_token: authedUser.refresh_token,
            token_expires: authedUser.token_expires,
            last_sync: new Date(),
            total_activities: activities.length
        }),
        activitiesSynced: activities.length
    };
}

module.exports = {
    syncUserActivities,
    refreshUserAccessToken,
    fetchActivityDetail,
    fetchActivityStreams,
    getUserStore,
    getActivityStore
};
