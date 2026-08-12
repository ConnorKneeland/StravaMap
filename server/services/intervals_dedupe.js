const crypto = require('crypto');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getIntervalsActivityModel = require('../models/intervals_activity');
const ActivityTypes = require('../../js/strava_activity_types');
const { normalizeSlug } = require('./connection');

const SUMMARY_FIELDS = Object.freeze([
    'name', 'description', 'type', 'sport_type', 'sub_type', 'activity_type_key', 'workout_category',
    'start_date', 'start_date_local', 'timezone', 'distance', 'elapsed_time', 'moving_time',
    'total_elevation_gain', 'total_elevation_loss', 'average_speed', 'max_speed', 'average_heartrate',
    'max_heartrate', 'average_cadence', 'average_watts', 'weighted_average_watts', 'max_watts',
    'calories', 'sport_metrics', 'average_temp', 'device_name', 'start_latlng', 'end_latlng', 'intervals'
]);

const CUSTOMIZATION_FIELDS = Object.freeze([
    'line_color', 'line_thickness', 'line_opacity', 'animation_speed_multiplier',
    'activity_type_override', 'activity_type_override_label'
]);

function getIntervalsActivityStore() {
    return isMongoConnected() ? wrapModel(getIntervalsActivityModel()) : memoryStore.intervalsActivities;
}

function hasValue(value) {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
}

function countStreamDatapoints(streamData) {
    return Object.values(streamData || {}).reduce((count, values) => {
        if (!Array.isArray(values)) return count;
        return count + values.reduce((items, value) => {
            if (Array.isArray(value)) return items + (value.length >= 2 ? 1 : 0);
            return items + (value === undefined || value === null || Number.isNaN(value) ? 0 : 1);
        }, 0);
    }, 0);
}

function getDataRichness(activity) {
    const streamData = activity && activity.stream_data || {};
    const streamKeys = Object.keys(streamData).filter((key) => Array.isArray(streamData[key])
        && streamData[key].some((value) => value !== undefined && value !== null));
    const datapoints = Math.max(
        Number(activity && activity.source_datapoint_count || 0),
        countStreamDatapoints(streamData)
    );
    const populatedSummaryFields = SUMMARY_FIELDS.reduce((count, key) => count + (hasValue(activity && activity[key]) ? 1 : 0), 0);
    return {
        datapoints,
        streamCount: Math.max(Number(activity && activity.source_stream_count || 0), streamKeys.length),
        populatedSummaryFields,
        hasRoute: Number(Array.isArray(activity && activity.stream_latlng) && activity.stream_latlng.length || 0)
    };
}

function compareActivityRichness(left, right) {
    const a = getDataRichness(left);
    const b = getDataRichness(right);
    for (const key of ['datapoints', 'streamCount', 'hasRoute', 'populatedSummaryFields']) {
        if (a[key] !== b[key]) return a[key] - b[key];
    }
    const leftIsProvider = left && left.import_source !== 'strava_export';
    const rightIsProvider = right && right.import_source !== 'strava_export';
    if (leftIsProvider !== rightIsProvider) return leftIsProvider ? 1 : -1;
    return String(right && right.activity_key || '').localeCompare(String(left && left.activity_key || ''));
}

function relativeDifference(leftValue, rightValue, absoluteFloor) {
    const left = Number(leftValue || 0);
    const right = Number(rightValue || 0);
    if (!(left > 0) || !(right > 0)) return Infinity;
    return Math.abs(left - right) / Math.max(absoluteFloor || 1, left, right);
}

function normalizeName(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getStartMs(activity) {
    const value = activity && (activity.start_date || activity.start_date_local);
    const parsed = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
}

function areLikelyDuplicateActivities(left, right) {
    if (!left || !right || left.activity_key === right.activity_key) return false;
    if (left.external_id && right.external_id && String(left.external_id) === String(right.external_id)) return true;
    const leftStart = getStartMs(left);
    const rightStart = getStartMs(right);
    if (!Number.isFinite(leftStart) || !Number.isFinite(rightStart)) return false;
    const startDifferenceSeconds = Math.abs(leftStart - rightStart) / 1000;
    if (startDifferenceSeconds > 120) return false;
    const leftType = ActivityTypes.normalizeActivityTypeKey(left);
    const rightType = ActivityTypes.normalizeActivityTypeKey(right);
    if (leftType && rightType && leftType !== rightType) return false;

    const durationClose = relativeDifference(
        Number(left.elapsed_time || left.moving_time),
        Number(right.elapsed_time || right.moving_time),
        60
    ) <= 0.08;
    const distanceClose = relativeDifference(left.distance, right.distance, 250) <= 0.06;
    const leftName = normalizeName(left.name);
    const nameEqual = Boolean(leftName && leftName === normalizeName(right.name));

    if (startDifferenceSeconds <= 15 && (durationClose || distanceClose || nameEqual)) return true;
    return durationClose && (distanceClose || nameEqual);
}

function mergeMissingFields(primary, secondaryActivities) {
    const update = {};
    for (const field of SUMMARY_FIELDS.concat(CUSTOMIZATION_FIELDS)) {
        if (hasValue(primary && primary[field])) continue;
        const donor = secondaryActivities.find((activity) => hasValue(activity && activity[field]));
        if (donor) update[field] = donor[field];
    }
    return update;
}

function buildSourceSummary(activity) {
    const richness = getDataRichness(activity);
    return {
        activity_key: activity.activity_key,
        intervals_activity_id: activity.intervals_activity_id,
        provider: activity.provider || 'intervals_icu',
        import_source: activity.import_source || null,
        source_activity_id: activity.source_activity_id || null,
        datapoints: richness.datapoints,
        stream_count: richness.streamCount
    };
}

function buildGroups(activities) {
    const parents = activities.map((_, index) => index);
    const find = (index) => {
        let current = index;
        while (parents[current] !== current) {
            parents[current] = parents[parents[current]];
            current = parents[current];
        }
        return current;
    };
    const unite = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };

    const ordered = activities.map((activity, index) => ({ activity, index, start: getStartMs(activity) }))
        .sort((left, right) => (left.start || 0) - (right.start || 0));
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
            if (Number.isFinite(ordered[leftIndex].start) && Number.isFinite(ordered[rightIndex].start)
                && ordered[rightIndex].start - ordered[leftIndex].start > 120000) break;
            if (areLikelyDuplicateActivities(ordered[leftIndex].activity, ordered[rightIndex].activity)) {
                unite(ordered[leftIndex].index, ordered[rightIndex].index);
            }
        }
    }
    const groups = new Map();
    activities.forEach((activity, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(activity);
    });
    return Array.from(groups.values());
}

async function reconcileDuplicateActivitiesForSlug(slugValue, providedStore) {
    const slug = normalizeSlug(slugValue);
    if (!slug) throw new Error('A valid slug is required for activity deduplication');
    const store = providedStore || getIntervalsActivityStore();
    const activities = await store.find({ user_slug: slug }, { sort: { start_date: 1 } });
    const groups = buildGroups(activities);
    let duplicateGroups = 0;
    let hidden = 0;
    for (const group of groups) {
        const ordered = group.slice().sort((left, right) => compareActivityRichness(right, left));
        const winner = ordered[0];
        const memberKeys = group.map((activity) => activity.activity_key).sort();
        const groupKey = group.length > 1
            ? `duplicate:${crypto.createHash('sha256').update(memberKeys.join('|')).digest('hex').slice(0, 20)}`
            : '';
        if (group.length > 1) duplicateGroups += 1;
        const sources = ordered.map(buildSourceSummary);
        const mergedFields = mergeMissingFields(winner, ordered.slice(1));
        for (const activity of group) {
            const isWinner = activity.activity_key === winner.activity_key;
            await store.updateOne({ activity_key: activity.activity_key, user_slug: slug }, Object.assign({
                dedupe_group_key: groupKey,
                dedupe_hidden: !isWinner,
                preferred_activity_key: winner.activity_key,
                dedupe_sources: sources,
                data_richness_score: getDataRichness(activity).datapoints
            }, isWinner ? mergedFields : {}));
            if (!isWinner) hidden += 1;
        }
    }
    return {
        totalRecords: activities.length,
        visibleRecords: activities.length - hidden,
        duplicateGroups,
        hiddenRecords: hidden
    };
}

module.exports = {
    countStreamDatapoints,
    getDataRichness,
    compareActivityRichness,
    areLikelyDuplicateActivities,
    reconcileDuplicateActivitiesForSlug
};
