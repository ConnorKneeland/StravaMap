const ActivityTypes = require('../js/strava_activity_types');

function getActivityKpiCategory(activity) {
    return ActivityTypes.getActivityTypeCategory(activity || {});
}

function getActivityKpiValues(activity) {
    return {
        count: 1,
        distance_meters: Number(activity && activity.distance || 0),
        moving_time_seconds: Number(activity && activity.moving_time || 0),
        elapsed_time_seconds: Number(activity && activity.elapsed_time || 0),
        elevation_gain_meters: Number(activity && activity.total_elevation_gain || 0)
    };
}

function addActivityToKpiSnapshot(snapshot, activity, options) {
    const values = getActivityKpiValues(activity);
    snapshot.count += values.count;
    snapshot.distance_meters += values.distance_meters;
    snapshot.moving_time_seconds += values.moving_time_seconds;
    snapshot.elapsed_time_seconds += values.elapsed_time_seconds;
    snapshot.elevation_gain_meters += values.elevation_gain_meters;

    const activityStart = activity && activity.start_date ? new Date(activity.start_date) : null;
    const priorStart = snapshot.latest_activity_start_date ? new Date(snapshot.latest_activity_start_date) : null;
    if (activityStart && !Number.isNaN(activityStart.getTime()) && (!priorStart || activityStart > priorStart)) {
        const resolver = options && typeof options.latestActivityId === 'function'
            ? options.latestActivityId
            : (item) => Number(item.strava_id || item.id || 0) || undefined;
        snapshot.latest_activity_id = resolver(activity);
        snapshot.latest_activity_start_date = activityStart;
    }
}

function buildKpiSnapshots(userSlug, activities, options) {
    const opts = options || {};
    const snapshotsByKey = new Map();
    (activities || []).forEach((activity) => {
        const category = getActivityKpiCategory(activity);
        if (!snapshotsByKey.has(category.key)) {
            snapshotsByKey.set(category.key, {
                id: `${opts.idPrefix ? `${opts.idPrefix}:` : ''}${String(userSlug || '').toLowerCase()}:${category.key}`,
                user_slug: String(userSlug || '').toLowerCase(),
                category_key: category.key,
                category_label: category.label,
                count: 0,
                distance_meters: 0,
                moving_time_seconds: 0,
                elapsed_time_seconds: 0,
                elevation_gain_meters: 0,
                latest_activity_id: undefined,
                latest_activity_start_date: undefined,
                recomputed_at: new Date()
            });
        }
        addActivityToKpiSnapshot(snapshotsByKey.get(category.key), activity, opts);
    });
    return Array.from(snapshotsByKey.values()).sort((left, right) => {
        return String(left.category_label).localeCompare(String(right.category_label));
    });
}

module.exports = {
    getActivityKpiCategory,
    getActivityKpiValues,
    buildKpiSnapshots
};
