const CYCLING_TYPES = new Set([
    'ride',
    'gravelride',
    'mountainbikeride',
    'virtualride',
    'ebikeride',
    'emountainbikeride',
    'velomobile',
    'handcycle'
]);

const RUNNING_TYPES = new Set([
    'run',
    'trailrun',
    'virtualrun'
]);

const CATEGORY_LABELS = {
    cycling: 'Cycling',
    running: 'Running',
    swim: 'Swimming',
    walk: 'Walking',
    hike: 'Hiking',
    workout: 'Workout',
    weighttraining: 'Weight Training',
    yoga: 'Yoga',
    golf: 'Golf',
    other: 'Other'
};

function normalizeActivityType(value) {
    return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function titleCaseType(value) {
    const text = String(value || 'Other').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return text.split(/\s+/).filter(Boolean).map((part) => {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join(' ') || 'Other';
}

function getActivityKpiCategory(activity) {
    const rawType = activity && (activity.sport_type || activity.type);
    const type = normalizeActivityType(rawType);
    if (CYCLING_TYPES.has(type)) {
        return { key: 'cycling', label: CATEGORY_LABELS.cycling };
    }
    if (RUNNING_TYPES.has(type)) {
        return { key: 'running', label: CATEGORY_LABELS.running };
    }
    if (CATEGORY_LABELS[type]) {
        return { key: type, label: CATEGORY_LABELS[type] };
    }
    return {
        key: type || 'other',
        label: titleCaseType(rawType || type || 'Other')
    };
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

function addActivityToKpiSnapshot(snapshot, activity) {
    const values = getActivityKpiValues(activity);
    snapshot.count += values.count;
    snapshot.distance_meters += values.distance_meters;
    snapshot.moving_time_seconds += values.moving_time_seconds;
    snapshot.elapsed_time_seconds += values.elapsed_time_seconds;
    snapshot.elevation_gain_meters += values.elevation_gain_meters;

    const activityStart = activity && activity.start_date ? new Date(activity.start_date) : null;
    const priorStart = snapshot.latest_activity_start_date ? new Date(snapshot.latest_activity_start_date) : null;
    if (activityStart && !Number.isNaN(activityStart.getTime()) && (!priorStart || activityStart > priorStart)) {
        snapshot.latest_activity_id = Number(activity.strava_id || activity.id || 0) || undefined;
        snapshot.latest_activity_start_date = activityStart;
    }
}

function buildKpiSnapshots(userSlug, activities) {
    const snapshotsByKey = new Map();
    (activities || []).forEach((activity) => {
        const category = getActivityKpiCategory(activity);
        if (!snapshotsByKey.has(category.key)) {
            snapshotsByKey.set(category.key, {
                id: `${String(userSlug || '').toLowerCase()}:${category.key}`,
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
        addActivityToKpiSnapshot(snapshotsByKey.get(category.key), activity);
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
