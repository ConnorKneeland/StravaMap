const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');
const getActivityModel = require('../models/activity');

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
        start_latlng: activity.start_latlng,
        end_latlng: activity.end_latlng,
        summary_polyline: activity.map && activity.map.summary_polyline ? activity.map.summary_polyline : null
    };
}

async function syncUserActivities(user) {
    const userStore = getUserStore();
    const activityStore = getActivityStore();
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
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
    const activities = [];
    const numPages = Number(user.num_pages || user.pages || 1);

    for (let page = 1; page <= numPages; page += 1) {
        const activitiesResponse = await fetch(`https://www.strava.com/api/v3/athlete/activities?access_token=${tokenData.access_token}&per_page=200&page=${page}`);
        if (!activitiesResponse.ok) {
            throw new Error(`Strava activities sync failed with ${activitiesResponse.status}`);
        }
        const pageActivities = await activitiesResponse.json();
        if (!Array.isArray(pageActivities) || !pageActivities.length) {
            break;
        }
        activities.push(...pageActivities.map((activity) => transformActivity(user, activity)));
        if (pageActivities.length < 200) {
            break;
        }
    }

    await activityStore.bulkUpsertActivities(activities);
    const updatedUser = await userStore.updateOne({ slug: user.slug }, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null,
        last_sync: new Date(),
        total_activities: activities.length
    });

    return {
        user: updatedUser || Object.assign({}, user, {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            token_expires: tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null,
            last_sync: new Date(),
            total_activities: activities.length
        }),
        activitiesSynced: activities.length
    };
}

module.exports = {
    syncUserActivities,
    getUserStore,
    getActivityStore
};
