const { PREVIEW_MAX_POINTS, PREVIEW_STREAM_KEYS } = require('./services/stream_storage');

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_PREVIEW_ACTIVITIES = 3;
const CURSOR_VERSION = 1;

const COMMON_SUMMARY_FIELDS = [
    'user_slug', 'name', 'type', 'sport_type', 'activity_type_key',
    'activity_type_override', 'activity_type_override_label', 'start_date',
    'start_date_local', 'timezone', 'distance', 'elapsed_time', 'moving_time',
    'total_elevation_gain', 'average_speed', 'max_speed', 'average_heartrate',
    'max_heartrate', 'average_cadence', 'average_watts', 'weighted_average_watts',
    'max_watts', 'device_watts', 'has_heartrate', 'calories', 'sport_metrics',
    'average_temp', 'device_name', 'location_city', 'location_state',
    'location_country', 'start_latlng', 'end_latlng', 'summary_polyline',
    'map_summary_polyline', 'line_color', 'line_thickness', 'line_opacity',
    'animation_speed_multiplier', 'detail_fetched_at', 'stream_fetched_at'
];

const STRAVA_SUMMARY_FIELDS = COMMON_SUMMARY_FIELDS.concat([
    'strava_id', 'external_id', 'upload_id', 'achievement_count', 'kudos_count',
    'comment_count', 'athlete_count', 'photo_count', 'elev_high', 'elev_low',
    'pr_count', 'workout_type', 'kilojoules', 'suffer_score', 'total_photo_count',
    'from_accepted_tag', 'hide_from_home', 'map_id', 'map_polyline',
    'map_resource_state', 'map_city', 'map_state', 'map_country',
    'upstream_deleted', 'upstream_deleted_at', 'upstream_delete_source'
]);

const INTERVALS_SUMMARY_FIELDS = COMMON_SUMMARY_FIELDS.concat([
    'id', 'intervals_activity_id', 'activity_key', 'schema_version', 'provider',
    'provider_athlete_id', 'import_source', 'source_activity_id', 'source_filename',
    'source_datapoint_count', 'source_stream_count', 'data_richness_score',
    'export_imported_at', 'upstream_source', 'external_id', 'sub_type',
    'workout_category', 'total_elevation_loss', 'trainer', 'commute', 'race',
    'perceived_exertion', 'map_fetched_at', 'dedupe_group_key', 'dedupe_hidden',
    'preferred_activity_key', 'last_synced_at'
]);

const STREAM_SAMPLE_FIELDS = [
    'stream_data', 'stream_preview', 'stream_preview_metadata', 'stream_latlng',
    'stream_velocity_smooth', 'stream_time'
];

class ActivityPageError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ActivityPageError';
        this.statusCode = 400;
        this.code = code;
    }
}

function buildProjection(fields, includePreview) {
    return fields.reduce((projection, field) => {
        projection[field] = 1;
        return projection;
    }, Object.assign({ _id: 0 }, includePreview ? {
        stream_preview: 1,
        stream_preview_metadata: 1
    } : {}));
}

function parsePageLimit(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_PAGE_LIMIT;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
        throw new ActivityPageError(
            `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
            'invalid_activity_limit'
        );
    }
    return limit;
}

function normalizeCursorId(provider, value) {
    if (provider === 'strava') {
        const id = Number(value);
        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }
    const id = typeof value === 'string' ? value.trim() : '';
    return id && id.length <= 128 ? id : null;
}

function parseActivityIds(value, provider) {
    if (value === undefined || value === null || value === '') return [];
    const rawValues = (Array.isArray(value) ? value : [value])
        .flatMap((item) => String(item).split(','))
        .map((item) => item.trim())
        .filter(Boolean);
    const uniqueRawValues = Array.from(new Set(rawValues));
    if (uniqueRawValues.length > MAX_PAGE_LIMIT) {
        throw new ActivityPageError(
            `ids may contain at most ${MAX_PAGE_LIMIT} activity IDs`,
            'too_many_activity_ids'
        );
    }
    const normalized = uniqueRawValues.map((valueItem) => normalizeCursorId(provider, valueItem));
    if (normalized.some((id) => id === null)) {
        throw new ActivityPageError('ids contains an invalid activity ID', 'invalid_activity_ids');
    }
    return Array.from(new Set(normalized));
}

function encodeActivityCursor(provider, activity, idField) {
    const date = new Date(activity && activity.start_date);
    const id = normalizeCursorId(provider, activity && activity[idField]);
    if (Number.isNaN(date.getTime()) || id === null) return null;
    return Buffer.from(JSON.stringify({
        v: CURSOR_VERSION,
        p: provider,
        d: date.toISOString(),
        i: id
    })).toString('base64url');
}

function decodeActivityCursor(value, provider) {
    if (value === undefined || value === null || value === '') return null;
    const encoded = String(value);
    if (encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
        throw new ActivityPageError('cursor is invalid', 'invalid_activity_cursor');
    }
    try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        const date = new Date(parsed && parsed.d);
        const id = normalizeCursorId(provider, parsed && parsed.i);
        if (!parsed || parsed.v !== CURSOR_VERSION || parsed.p !== provider
            || Number.isNaN(date.getTime()) || date.toISOString() !== parsed.d || id === null) {
            throw new Error('Invalid cursor payload');
        }
        return { date, id };
    } catch (error) {
        throw new ActivityPageError('cursor is invalid', 'invalid_activity_cursor');
    }
}

function addCursorFilter(filter, cursor, idField) {
    if (!cursor) return filter;
    const cursorPredicate = {
        $or: [
            { start_date: { $lt: cursor.date } },
            { start_date: cursor.date, [idField]: { $lt: cursor.id } }
        ]
    };
    if (filter && Object.prototype.hasOwnProperty.call(filter, '$or')) {
        const baseFilter = Object.assign({}, filter);
        delete baseFilter.$or;
        return Object.assign(baseFilter, {
            $and: [{ $or: filter.$or }, cursorPredicate]
        });
    }
    return Object.assign({}, filter, cursorPredicate);
}

function sanitizePreview(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const preview = Object.entries(value).reduce((result, [key, samples]) => {
        if (PREVIEW_STREAM_KEYS.includes(key) && Array.isArray(samples)) {
            result[key] = samples.slice(0, PREVIEW_MAX_POINTS);
        }
        return result;
    }, {});
    return Object.keys(preview).length ? preview : undefined;
}

function pickSummary(activity, fields, includePreview) {
    const summary = fields.reduce((result, field) => {
        if (activity && activity[field] !== undefined) result[field] = activity[field];
        return result;
    }, {});
    if (includePreview) {
        const preview = sanitizePreview(activity && activity.stream_preview);
        if (preview) summary.stream_preview = preview;
        if (preview && activity.stream_preview_metadata) {
            summary.stream_preview_metadata = activity.stream_preview_metadata;
        }
    }
    return summary;
}

function stripStreamSamples(activity) {
    if (!activity || typeof activity !== 'object') return activity;
    const result = Object.assign({}, activity);
    STREAM_SAMPLE_FIELDS.forEach((field) => delete result[field]);
    return result;
}

function useLegacyActivityListContract(query = {}) {
    const requestedVersion = String(query.activity_list_version || '').trim();
    if (requestedVersion === '2') return false;
    return String(process.env.ACTIVITY_LIST_V2_ENABLED || '').trim().toLowerCase() !== 'true';
}

async function findLegacyActivities(options) {
    const {
        store, filter, fields, query = {}
    } = options;
    const requestedLimit = query.limit === undefined || query.limit === null || query.limit === ''
        ? null
        : parsePageLimit(query.limit);
    const includePreview = query.include_preview === '1' || query.include_preview === 1;
    if (includePreview && (requestedLimit === null || requestedLimit > MAX_PREVIEW_ACTIVITIES)) {
        throw new ActivityPageError(
            `include_preview may be used with at most ${MAX_PREVIEW_ACTIVITIES} activities`,
            'activity_preview_limit_exceeded'
        );
    }
    const idsRequested = Boolean(String(query.ids || '').trim());
    const records = await store.find(filter, {
        sort: { start_date: -1 },
        ...(requestedLimit !== null ? { limit: requestedLimit } : {})
    });
    if (idsRequested) {
        return records.map((record) => pickSummary(record, fields, false));
    }
    return records;
}

async function findActivityPage(options) {
    const {
        store, filter, provider, idField, fields, query = {}
    } = options;
    const limit = parsePageLimit(query.limit);
    const cursor = decodeActivityCursor(query.cursor, provider);
    const includePreview = query.include_preview === '1' || query.include_preview === 1;
    if (includePreview && limit > MAX_PREVIEW_ACTIVITIES) {
        throw new ActivityPageError(
            `include_preview may be used with at most ${MAX_PREVIEW_ACTIVITIES} activities`,
            'activity_preview_limit_exceeded'
        );
    }
    const pageFilter = addCursorFilter(filter, cursor, idField);
    const records = await store.find(pageFilter, {
        sort: { start_date: -1, [idField]: -1 },
        limit: limit + 1,
        select: buildProjection(fields, includePreview)
    });
    const hasMore = records.length > limit;
    const visibleRecords = records.slice(0, limit);
    const activities = visibleRecords.map((record) => pickSummary(record, fields, includePreview));
    return {
        activities,
        pagination: {
            limit,
            has_more: hasMore,
            next_cursor: hasMore && visibleRecords.length
                ? encodeActivityCursor(provider, visibleRecords[visibleRecords.length - 1], idField)
                : null
        }
    };
}

module.exports = {
    ActivityPageError,
    MAX_PREVIEW_ACTIVITIES,
    STRAVA_SUMMARY_FIELDS,
    INTERVALS_SUMMARY_FIELDS,
    STREAM_SAMPLE_FIELDS,
    buildProjection,
    parsePageLimit,
    parseActivityIds,
    encodeActivityCursor,
    decodeActivityCursor,
    findActivityPage,
    stripStreamSamples,
    useLegacyActivityListContract,
    findLegacyActivities
};
