const PREVIEW_SCHEMA_VERSION = 1;
const PREVIEW_MAX_POINTS = 400;
const STREAM_WRITE_MAX_ATTEMPTS = 6;
const PREVIEW_STREAM_KEYS = Object.freeze([
    'latlng', 'time', 'distance', 'altitude', 'velocity_smooth', 'heartrate'
]);
const LEGACY_ACTIVITY_STREAM_SELECT = Object.freeze({
    _id: 0,
    stream_data: 1,
    stream_latlng: 1,
    stream_velocity_smooth: 1,
    stream_time: 1,
    stream_keys: 1,
    stream_requested_keys: 1,
    stream_metadata: 1,
    stream_resolution: 1,
    stream_series_type: 1,
    stream_fetched_at: 1
});

function compactObject(value) {
    return Object.entries(value || {}).reduce((result, [key, item]) => {
        if (item !== undefined) result[key] = item;
        return result;
    }, {});
}

function cloneStreamValues(values) {
    return values.map((value) => Array.isArray(value) ? value.slice() : value);
}

function normalizeCanonicalStreamData(value) {
    const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const source = envelope.stream_data && typeof envelope.stream_data === 'object'
        ? envelope.stream_data
        : (envelope.streams && typeof envelope.streams === 'object' ? envelope.streams : envelope);
    return Object.entries(source || {}).reduce((streams, [rawKey, rawValue]) => {
        const key = String(rawKey || '').trim();
        if (!key) return streams;
        if (Array.isArray(rawValue)) {
            streams[key] = cloneStreamValues(rawValue);
            return streams;
        }
        if (rawValue && typeof rawValue === 'object' && Array.isArray(rawValue.data)) {
            if (key === 'latlng' && Array.isArray(rawValue.data2)) {
                streams[key] = rawValue.data.map((latitude, index) => [latitude, rawValue.data2[index]]);
            } else {
                streams[key] = cloneStreamValues(rawValue.data);
            }
        }
        return streams;
    }, {});
}

function extractCanonicalStreamData(record) {
    const streams = normalizeCanonicalStreamData(record && record.stream_data || {});
    const legacyFields = [
        ['latlng', 'stream_latlng'],
        ['velocity_smooth', 'stream_velocity_smooth'],
        ['time', 'stream_time']
    ];
    for (const [streamKey, field] of legacyFields) {
        const canonicalValues = streams[streamKey];
        const legacyValues = record && record[field];
        if (Array.isArray(legacyValues) && legacyValues.length
            && (!Array.isArray(canonicalValues) || legacyValues.length > canonicalValues.length)) {
            streams[streamKey] = cloneStreamValues(legacyValues);
        }
    }
    return streams;
}

function mergeUniqueStrings(...values) {
    return Array.from(new Set(values.flatMap((items) => items || [])
        .map((value) => String(value || '').trim()).filter(Boolean)));
}

function newestDate(...values) {
    let newest;
    for (const value of values) {
        if (!value) continue;
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) continue;
        if (!newest || timestamp > newest.getTime()) newest = new Date(timestamp);
    }
    return newest;
}

function isDuplicateKeyError(error) {
    return Boolean(error && (error.code === 11000 || error.code === 11001));
}

function buildMergedStreamRecord(identity, legacySource, observed, incoming) {
    const legacy = legacySource || {};
    const current = observed || {};
    const fresh = incoming || {};
    const freshHasVariant = Boolean(fresh.stream_resolution || fresh.stream_series_type);
    const isCompatibleSource = (source) => !freshHasVariant || !source
        || (!source.stream_resolution && !source.stream_series_type)
        || (fresh.stream_resolution === source.stream_resolution
            && fresh.stream_series_type === source.stream_series_type);
    const currentForMerge = isCompatibleSource(current) ? current : {};
    const legacyForMerge = isCompatibleSource(legacy) ? legacy : {};
    const streamData = Object.assign(
        {},
        extractCanonicalStreamData(legacyForMerge),
        extractCanonicalStreamData(currentForMerge),
        extractCanonicalStreamData(fresh)
    );
    const actualStreamKeys = Object.keys(streamData).filter((key) => (
        Array.isArray(streamData[key]) && streamData[key].length
    ));
    const metadata = Object.assign(
        {},
        legacyForMerge.stream_metadata || {},
        currentForMerge.stream_metadata || {},
        fresh.stream_metadata || {}
    );
    return compactObject(Object.assign({}, identity, {
        schema_version: Math.max(
            1,
            Number(legacy.schema_version || 0),
            Number(current.schema_version || 0),
            Number(fresh.schema_version || 0)
        ),
        provider: fresh.provider || current.provider || legacy.provider,
        stream_data: streamData,
        stream_keys: actualStreamKeys,
        stream_requested_keys: mergeUniqueStrings(
            legacyForMerge.stream_requested_keys,
            currentForMerge.stream_requested_keys,
            fresh.stream_requested_keys,
            Object.keys(extractCanonicalStreamData(fresh))
        ).filter((key) => actualStreamKeys.includes(key)),
        stream_metadata: metadata,
        stream_resolution: fresh.stream_resolution
            || currentForMerge.stream_resolution || legacyForMerge.stream_resolution,
        stream_series_type: fresh.stream_series_type
            || currentForMerge.stream_series_type || legacyForMerge.stream_series_type,
        stream_fetched_at: newestDate(
            legacyForMerge.stream_fetched_at,
            currentForMerge.stream_fetched_at,
            fresh.stream_fetched_at
        )
    }));
}

async function mergeStreamRecordWithRetry(streamStore, identity, legacySource, incoming, options = {}) {
    const maximumAttempts = Math.max(1, Number(options.maxAttempts || STREAM_WRITE_MAX_ATTEMPTS));
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        const observed = await streamStore.findOne(identity);
        const fresh = typeof options.prepareIncoming === 'function'
            ? options.prepareIncoming(observed, legacySource, incoming)
            : incoming;
        const record = buildMergedStreamRecord(identity, legacySource, observed, fresh);
        if (observed) {
            const written = await streamStore.compareAndSwap(identity, observed, record);
            if (written) return written;
            continue;
        }
        try {
            return await streamStore.insertIfAbsent(record);
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
        }
    }
    const error = new Error('Could not persist activity streams after concurrent updates');
    error.code = 'stream_write_conflict';
    throw error;
}

function buildPreviewCasFilter(identity, canonicalRecord) {
    if (!canonicalRecord || !canonicalRecord.updatedAt) return identity;
    return Object.assign({}, identity, {
        $or: [
            { stream_preview_source_updated_at: { $exists: false } },
            { stream_preview_source_updated_at: { $lte: canonicalRecord.updatedAt } }
        ]
    });
}

async function updateActivityStreamPreview(activityStore, identity, canonicalRecord, options = {}) {
    const streamData = extractCanonicalStreamData(canonicalRecord || {});
    const artifacts = buildStreamArtifacts(streamData);
    if (options.fields && Object.keys(options.fields).length) {
        await activityStore.updateOne(identity, options.fields);
    }
    const update = buildActivityStreamFields(streamData, canonicalRecord || {});
    if (canonicalRecord && canonicalRecord.updatedAt) {
        update.stream_preview_source_updated_at = canonicalRecord.updatedAt;
    }
    if (artifacts.summary_polyline) {
        if (options.preserveSummaryPolyline) {
            if (!options.existingActivity || !options.existingActivity.summary_polyline) {
                update.summary_polyline = artifacts.summary_polyline;
            }
            if (!options.existingActivity || !options.existingActivity.map_summary_polyline) {
                update.map_summary_polyline = artifacts.summary_polyline;
            }
        } else {
            update.summary_polyline = artifacts.summary_polyline;
            update.map_summary_polyline = artifacts.summary_polyline;
        }
    }
    return activityStore.updateOne(buildPreviewCasFilter(identity, canonicalRecord), update);
}

async function loadProviderStreamSources(activityStore, streamStore, filter, activitySelect) {
    const activity = await activityStore.findOne(filter, { select: activitySelect });
    const streamRecord = await streamStore.findOne(filter);
    if (streamRecord || !activity) {
        return {
            activity,
            streamRecord,
            streamSource: streamRecord || null,
            usedLegacyFallback: false
        };
    }

    // Compatibility for records written before full telemetry moved into the
    // provider-specific stream collections. This intentionally runs only after
    // a canonical stream miss so normal hydration never reads the large legacy
    // arrays from the activity collection.
    const legacyActivity = await activityStore.findOne(filter, {
        select: LEGACY_ACTIVITY_STREAM_SELECT
    });
    return {
        activity,
        streamRecord: null,
        streamSource: legacyActivity || null,
        usedLegacyFallback: Boolean(legacyActivity)
    };
}

function choosePreviewReferenceStream(streams) {
    if (Array.isArray(streams.latlng) && streams.latlng.length) {
        return { key: 'latlng', length: streams.latlng.length };
    }
    return { key: '', length: 0 };
}

function buildSampleIndexes(length, maximumPoints) {
    const maximum = Math.max(2, Math.min(PREVIEW_MAX_POINTS, Number(maximumPoints) || PREVIEW_MAX_POINTS));
    if (length <= maximum) return Array.from({ length }, (_, index) => index);
    const indexes = [];
    for (let position = 0; position < maximum; position += 1) {
        const index = Math.round(position * (length - 1) / (maximum - 1));
        if (indexes[indexes.length - 1] !== index) indexes.push(index);
    }
    return indexes;
}

function sampleAlignedValues(values, indexes, referenceLength) {
    if (!Array.isArray(values) || !values.length || referenceLength <= 0) return [];
    return indexes.map((referenceIndex) => {
        const sourceIndex = referenceLength <= 1 || values.length <= 1
            ? 0
            : Math.round(referenceIndex * (values.length - 1) / (referenceLength - 1));
        const item = values[Math.max(0, Math.min(values.length - 1, sourceIndex))];
        return Array.isArray(item) ? item.slice() : item;
    });
}

function buildStreamPreview(value, options = {}) {
    const streams = normalizeCanonicalStreamData(value);
    const reference = choosePreviewReferenceStream(streams);
    if (!reference.length) {
        return {
            stream_preview: {},
            stream_preview_metadata: {
                schema_version: PREVIEW_SCHEMA_VERSION,
                reference_key: null,
                alignment: null,
                original_point_count: 0,
                point_count: 0,
                stream_point_counts: {}
            }
        };
    }
    const indexes = buildSampleIndexes(reference.length, options.maxPoints);
    const preview = {};
    for (const key of PREVIEW_STREAM_KEYS) {
        const values = streams[key];
        if (!Array.isArray(values) || !values.length) continue;
        preview[key] = sampleAlignedValues(values, indexes, reference.length);
    }
    return {
        stream_preview: preview,
        stream_preview_metadata: {
            schema_version: PREVIEW_SCHEMA_VERSION,
            reference_key: reference.key,
            alignment: 'normalized_progress',
            original_point_count: reference.length,
            point_count: indexes.length,
            stream_point_counts: Object.keys(preview).reduce((counts, key) => {
                counts[key] = Array.isArray(streams[key]) ? streams[key].length : 0;
                return counts;
            }, {})
        }
    };
}

function isValidCoordinate(value) {
    return Array.isArray(value) && value.length >= 2
        && Number.isFinite(Number(value[0])) && Number(value[0]) >= -90 && Number(value[0]) <= 90
        && Number.isFinite(Number(value[1])) && Number(value[1]) >= -180 && Number(value[1]) <= 180;
}

function encodeSignedNumber(value) {
    // Arithmetic avoids JavaScript's signed 32-bit bit-shift coercion for large
    // first-point coordinate deltas.
    let number = value < 0 ? (-value * 2) - 1 : value * 2;
    let encoded = '';
    while (number >= 0x20) {
        encoded += String.fromCharCode((0x20 | (number % 32)) + 63);
        number = Math.floor(number / 32);
    }
    return encoded + String.fromCharCode(number + 63);
}

function encodeCompactPolyline(coordinatesValue) {
    const coordinates = (coordinatesValue || []).filter(isValidCoordinate);
    if (coordinates.length < 2) return '';
    let previousLatitude = 0;
    let previousLongitude = 0;
    let encoded = '';
    for (const coordinate of coordinates) {
        const latitude = Math.round(Number(coordinate[0]) * 1e5);
        const longitude = Math.round(Number(coordinate[1]) * 1e5);
        encoded += encodeSignedNumber(latitude - previousLatitude);
        encoded += encodeSignedNumber(longitude - previousLongitude);
        previousLatitude = latitude;
        previousLongitude = longitude;
    }
    return encoded;
}

function buildStreamArtifacts(value, options = {}) {
    const streamData = normalizeCanonicalStreamData(value);
    const preview = buildStreamPreview(streamData, options);
    const previewRoute = preview.stream_preview.latlng || [];
    return Object.assign({
        stream_data: streamData,
        stream_keys: Object.keys(streamData),
        summary_polyline: encodeCompactPolyline(previewRoute)
    }, preview);
}

function buildActivityStreamFields(value, metadata = {}) {
    const artifacts = buildStreamArtifacts(value, metadata);
    return compactObject({
        stream_keys: metadata.stream_keys || artifacts.stream_keys,
        stream_requested_keys: metadata.stream_requested_keys,
        stream_metadata: metadata.stream_metadata,
        stream_resolution: metadata.stream_resolution,
        stream_series_type: metadata.stream_series_type,
        stream_fetched_at: metadata.stream_fetched_at,
        stream_preview: artifacts.stream_preview,
        stream_preview_metadata: artifacts.stream_preview_metadata
    });
}

module.exports = {
    PREVIEW_SCHEMA_VERSION,
    PREVIEW_MAX_POINTS,
    STREAM_WRITE_MAX_ATTEMPTS,
    PREVIEW_STREAM_KEYS,
    LEGACY_ACTIVITY_STREAM_SELECT,
    normalizeCanonicalStreamData,
    extractCanonicalStreamData,
    mergeUniqueStrings,
    newestDate,
    buildMergedStreamRecord,
    mergeStreamRecordWithRetry,
    buildPreviewCasFilter,
    updateActivityStreamPreview,
    loadProviderStreamSources,
    buildStreamPreview,
    sampleAlignedValues,
    encodeCompactPolyline,
    buildStreamArtifacts,
    buildActivityStreamFields
};
