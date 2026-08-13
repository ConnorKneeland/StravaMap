require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
const { connectDb, isMongoConnected } = require('./db');
const getActivityModel = require('./models/activity');
const getIntervalsActivityModel = require('./models/intervals_activity');
const getActivityStreamModel = require('./models/activity_stream');
const getIntervalsActivityStreamModel = require('./models/intervals_activity_stream');
const {
    extractCanonicalStreamData,
    normalizeCanonicalStreamData,
    buildStreamArtifacts,
    buildActivityStreamFields
} = require('./services/stream_storage');

const LEGACY_STREAM_FIELDS = Object.freeze([
    'stream_data',
    'stream_latlng',
    'stream_velocity_smooth',
    'stream_time'
]);
const MIGRATION_CAS_MAX_ATTEMPTS = 5;

const REQUIRED_INDEX_DEFINITIONS = Object.freeze({
    strava: Object.freeze([
        Object.freeze({
            target: 'stream',
            name: 'activity_streams_user_slug_strava_id_unique',
            key: Object.freeze({ user_slug: 1, strava_id: 1 }),
            unique: true
        }),
        Object.freeze({
            target: 'activity',
            name: 'activities_user_slug_start_date_strava_id_pagination',
            key: Object.freeze({ user_slug: 1, start_date: -1, strava_id: -1 }),
            unique: false
        })
    ]),
    intervals: Object.freeze([
        Object.freeze({
            target: 'stream',
            name: 'intervals_activity_streams_user_slug_intervals_activity_id_unique',
            key: Object.freeze({ user_slug: 1, intervals_activity_id: 1 }),
            unique: true
        }),
        Object.freeze({
            target: 'activity',
            name: 'intervals_activities_user_slug_start_date_intervals_activity_id_pagination',
            key: Object.freeze({ user_slug: 1, start_date: -1, intervals_activity_id: -1 }),
            unique: false
        })
    ])
});

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
    }, {});
}

function streamHash(streamData) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(stableValue(normalizeCanonicalStreamData(streamData))))
        .digest('hex');
}

function arrayHash(values) {
    return crypto.createHash('sha256').update(JSON.stringify(stableValue(values))).digest('hex');
}

function buildMigrationStreamSources(activity, existingStream) {
    const sources = [];
    const add = (name, streamData) => {
        const normalized = normalizeCanonicalStreamData(streamData || {});
        if (Object.keys(normalized).length) sources.push({ name, stream_data: normalized });
    };
    add('activity.stream_data', activity && activity.stream_data);
    const legacyFields = [
        ['latlng', 'stream_latlng'],
        ['velocity_smooth', 'stream_velocity_smooth'],
        ['time', 'stream_time']
    ];
    for (const [streamKey, field] of legacyFields) {
        const values = activity && activity[field];
        if (Array.isArray(values) && values.length) {
            add(`activity.${field}`, { [streamKey]: values });
        }
    }
    add('stream_collection.stream_data', existingStream && existingStream.stream_data);
    return sources;
}

function reconcileStreamSources(sourcesValue) {
    const candidatesByKey = new Map();
    for (const source of sourcesValue || []) {
        const streams = normalizeCanonicalStreamData(source && source.stream_data || {});
        for (const [key, values] of Object.entries(streams)) {
            if (!Array.isArray(values) || !values.length) continue;
            if (!candidatesByKey.has(key)) candidatesByKey.set(key, []);
            candidatesByKey.get(key).push({ source: String(source.name || 'unknown'), values });
        }
    }
    const streamData = {};
    const conflicts = [];
    for (const [key, candidates] of candidatesByKey.entries()) {
        const maximumLength = Math.max(...candidates.map((candidate) => candidate.values.length));
        const richest = candidates.filter((candidate) => candidate.values.length === maximumLength);
        const variants = new Map();
        for (const candidate of richest) {
            const hash = arrayHash(candidate.values);
            if (!variants.has(hash)) variants.set(hash, []);
            variants.get(hash).push(candidate);
        }
        if (variants.size > 1) {
            conflicts.push({
                key,
                length: maximumLength,
                sources: richest.map((candidate) => candidate.source)
            });
            continue;
        }
        streamData[key] = richest[0].values;
    }
    return { stream_data: streamData, conflicts };
}

function reconcileMigrationStreams(activity, existingStream) {
    return reconcileStreamSources(buildMigrationStreamSources(activity, existingStream));
}

function indexKeysEqual(left, right) {
    const leftEntries = Object.entries(left || {});
    const rightEntries = Object.entries(right || {});
    return leftEntries.length === rightEntries.length && leftEntries.every(([key, direction], index) => (
        rightEntries[index][0] === key && Number(rightEntries[index][1]) === Number(direction)
    ));
}

function materializeRequiredIndexes(config) {
    return REQUIRED_INDEX_DEFINITIONS[config.provider].map((definition) => Object.assign({}, definition, {
        collection: definition.target === 'stream'
            ? config.streamModel.collection
            : config.activityModel.collection
    }));
}

async function listIndexesSafely(collection) {
    try {
        return await collection.indexes();
    } catch (error) {
        if (error && (error.code === 26 || error.codeName === 'NamespaceNotFound')) return [];
        throw error;
    }
}

async function inspectRequiredIndexes(config) {
    const definitions = materializeRequiredIndexes(config);
    const indexesByCollection = new Map();
    for (const definition of definitions) {
        if (!indexesByCollection.has(definition.collection)) {
            indexesByCollection.set(definition.collection, await listIndexesSafely(definition.collection));
        }
    }
    return definitions.map((definition) => {
        const matching = indexesByCollection.get(definition.collection)
            .filter((index) => indexKeysEqual(index.key, definition.key));
        const compatible = matching.find((index) => !definition.unique || index.unique === true);
        return {
            target: definition.target,
            name: definition.name,
            key: definition.key,
            unique: definition.unique,
            status: compatible ? 'present' : matching.length ? 'incompatible' : 'missing',
            existing_name: compatible && compatible.name || matching[0] && matching[0].name || null
        };
    });
}

async function ensureRequiredIndexes(config, options = {}) {
    const apply = Boolean(options.apply);
    const initial = await inspectRequiredIndexes(config);
    if (!apply) return initial;
    const incompatible = initial.filter((index) => index.status === 'incompatible');
    if (incompatible.length) {
        throw new Error(`Required ${config.provider} index is incompatible: ${incompatible[0].name}`);
    }
    const definitions = materializeRequiredIndexes(config);
    for (const missing of initial.filter((index) => index.status === 'missing')) {
        const definition = definitions.find((item) => item.name === missing.name);
        try {
            await definition.collection.createIndex(definition.key, {
                name: definition.name,
                ...(definition.unique ? { unique: true } : {})
            });
        } catch (error) {
            throw new Error(
                `Could not establish required ${config.provider} index ${definition.name}: ${error.message}`
            );
        }
    }
    const verified = await inspectRequiredIndexes(config);
    const unavailable = verified.find((index) => index.status !== 'present');
    if (unavailable) {
        throw new Error(`Required ${config.provider} index could not be verified: ${unavailable.name}`);
    }
    const initiallyMissing = new Set(initial.filter((index) => index.status === 'missing').map((index) => index.name));
    return verified.map((index) => Object.assign({}, index, {
        status: initiallyMissing.has(index.name) ? 'created' : 'verified'
    }));
}

function parseArguments(args) {
    const apply = args.includes('--apply');
    const cleanup = args.includes('--cleanup');
    const providerArgument = args.find((value) => value.startsWith('--provider='));
    const provider = providerArgument ? providerArgument.slice('--provider='.length) : 'all';
    if (!['all', 'strava', 'intervals'].includes(provider)) {
        throw new Error('--provider must be all, strava, or intervals');
    }
    if (cleanup && !apply) throw new Error('--cleanup requires --apply');
    const unknown = args.filter((value) => !['--apply', '--cleanup'].includes(value) && !value.startsWith('--provider='));
    if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
    return { apply, cleanup, provider };
}

function buildProviderConfig(provider) {
    if (provider === 'strava') {
        return {
            provider,
            activityModel: getActivityModel(),
            streamModel: getActivityStreamModel(),
            idField: 'strava_id',
            providerValue: undefined
        };
    }
    return {
        provider,
        activityModel: getIntervalsActivityModel(),
        streamModel: getIntervalsActivityStreamModel(),
        idField: 'intervals_activity_id',
        providerValue: 'intervals_icu'
    };
}

function buildCandidateFilter() {
    return {
        $or: [
            { stream_data: { $exists: true } },
            { stream_latlng: { $exists: true } },
            { stream_velocity_smooth: { $exists: true } },
            { stream_time: { $exists: true } }
        ]
    };
}

async function countRemainingCleanupCandidates(config) {
    return config.activityModel.collection.countDocuments(
        buildCandidateFilter(),
        { maxTimeMS: 30000 }
    );
}

function maximumDate(...values) {
    const dates = values.map((value) => value ? new Date(value) : null)
        .filter((value) => value && !Number.isNaN(value.getTime()));
    return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : undefined;
}

function buildStreamRecord(config, activity, streamData, existingStream = null) {
    const id = activity[config.idField];
    const streamKeys = Object.keys(streamData);
    const requestedKeys = Array.from(new Set([
        ...(activity.stream_requested_keys || []),
        ...(existingStream && existingStream.stream_requested_keys || [])
    ]
        .map((key) => String(key || '').trim())
        .filter((key) => streamKeys.includes(key))));
    const streamFetchedAt = maximumDate(
        activity.stream_fetched_at,
        existingStream && existingStream.stream_fetched_at
    );
    return {
        schema_version: Math.max(1, Number(existingStream && existingStream.schema_version || 0)),
        user_slug: activity.user_slug,
        [config.idField]: id,
        ...(config.providerValue ? {
            provider: existingStream && existingStream.provider || activity.provider || config.providerValue
        } : {}),
        stream_data: streamData,
        stream_keys: streamKeys,
        stream_requested_keys: requestedKeys.length ? requestedKeys : streamKeys,
        stream_metadata: Object.assign(
            {},
            activity.stream_metadata || {},
            existingStream && existingStream.stream_metadata || {}
        ),
        stream_resolution: existingStream && existingStream.stream_resolution || activity.stream_resolution,
        stream_series_type: existingStream && existingStream.stream_series_type || activity.stream_series_type,
        stream_fetched_at: streamFetchedAt
    };
}

function streamRecordTimestamp(record) {
    const value = record && (record.updatedAt || record.stream_fetched_at);
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function migrationActivityProjection(config) {
    return {
        _id: 1,
        updatedAt: 1,
        user_slug: 1,
        [config.idField]: 1,
        provider: 1,
        stream_data: 1,
        stream_latlng: 1,
        stream_velocity_smooth: 1,
        stream_time: 1,
        stream_keys: 1,
        stream_requested_keys: 1,
        stream_metadata: 1,
        stream_resolution: 1,
        stream_series_type: 1,
        stream_fetched_at: 1,
        stream_preview_source_updated_at: 1,
        summary_polyline: 1,
        map_summary_polyline: 1
    };
}

async function resolveLean(query) {
    if (query && typeof query.select === 'function') return query.lean();
    if (query && typeof query.lean === 'function') return query.lean();
    return query;
}

async function readMigrationActivity(config, identity, activityId) {
    let query = config.activityModel.findOne(Object.assign({ _id: activityId }, identity));
    if (query && typeof query.select === 'function') query = query.select(migrationActivityProjection(config));
    return resolveLean(query);
}

async function readMigrationStream(config, identity) {
    return resolveLean(config.streamModel.findOne(identity));
}

function buildObservedCasFilter(identity, observed) {
    if (!observed || observed._id === undefined || observed._id === null) return null;
    return Object.assign({}, identity, {
        _id: observed._id,
        updatedAt: observed.updatedAt === undefined || observed.updatedAt === null
            ? { $exists: false }
            : observed.updatedAt
    });
}

function isDuplicateKeyError(error) {
    return Boolean(error && (error.code === 11000 || error.codeName === 'DuplicateKey'));
}

function toPlainRecord(value) {
    if (!value) return value;
    return typeof value.toObject === 'function' ? value.toObject() : value;
}

async function writeStreamWithCas(config, identity, observed, record) {
    if (!observed) {
        try {
            return toPlainRecord(await config.streamModel.create(record));
        } catch (error) {
            if (isDuplicateKeyError(error)) return null;
            throw error;
        }
    }
    const casFilter = buildObservedCasFilter(identity, observed);
    if (!casFilter) return null;
    const query = config.streamModel.findOneAndUpdate(casFilter, { $set: record }, {
        new: true,
        upsert: false,
        runValidators: true
    });
    return resolveLean(query);
}

function updateMatched(result) {
    return Number(result && (result.matchedCount ?? result.n ?? result.nMatched) || 0) > 0;
}

function buildLegacyStreamUnset() {
    return LEGACY_STREAM_FIELDS.reduce((unset, field) => {
        unset[field] = '';
        return unset;
    }, {});
}

async function verifyLegacyStreamsRemoved(config, activityId) {
    const cleaned = await config.activityModel.collection.findOne(
        { _id: activityId },
        { projection: LEGACY_STREAM_FIELDS.reduce((projection, field) => {
            projection[field] = 1;
            return projection;
        }, {}) }
    );
    if (!cleaned) return 'activity_not_found_after_cleanup';
    const retainedLegacyField = LEGACY_STREAM_FIELDS.find((field) => (
        Object.prototype.hasOwnProperty.call(cleaned, field)
    ));
    return retainedLegacyField ? `unset_failed:${retainedLegacyField}` : '';
}

async function migrateActivity(config, activity, options = {}) {
    const apply = options === true || Boolean(options.apply);
    const cleanup = options === true || Boolean(options.cleanup);
    const id = activity[config.idField];
    if (!activity.user_slug || id === undefined || id === null || id === '') {
        return { status: 'skipped', reason: 'missing_identity' };
    }
    const filter = { user_slug: activity.user_slug, [config.idField]: id };
    if (!apply) {
        const existingStream = await readMigrationStream(config, filter);
        const reconciliation = reconcileMigrationStreams(activity, existingStream);
        if (reconciliation.conflicts.length) {
            return {
                status: 'failed',
                reason: `stream_conflict:${reconciliation.conflicts.map((conflict) => conflict.key).join(',')}`,
                conflicts: reconciliation.conflicts
            };
        }
        const streamData = reconciliation.stream_data;
        if (!Object.keys(streamData).length) return { status: 'skipped', reason: 'empty_streams' };
        const artifacts = buildStreamArtifacts(streamData);
        return {
            status: 'planned',
            streams: Object.keys(streamData).length,
            previewPoints: artifacts.stream_preview_metadata.point_count
        };
    }

    for (let attempt = 0; attempt < MIGRATION_CAS_MAX_ATTEMPTS; attempt += 1) {
        // Both records are reread on every attempt. This prevents the migration
        // from overwriting a stream or embedded legacy array written after the
        // outer cursor captured its lightweight identity snapshot.
        const currentActivity = await readMigrationActivity(config, filter, activity._id);
        if (!currentActivity) return { status: 'failed', reason: 'activity_not_found' };
        const existingStream = await readMigrationStream(config, filter);
        const reconciliation = reconcileMigrationStreams(currentActivity, existingStream);
        if (reconciliation.conflicts.length) {
            return {
                status: 'failed',
                reason: `stream_conflict:${reconciliation.conflicts.map((conflict) => conflict.key).join(',')}`,
                conflicts: reconciliation.conflicts
            };
        }
        const streamData = reconciliation.stream_data;
        if (!Object.keys(streamData).length) {
            if (!cleanup) return { status: 'skipped', reason: 'empty_streams' };
            const emptyActivityCasFilter = buildObservedCasFilter(filter, currentActivity);
            if (!emptyActivityCasFilter) return { status: 'failed', reason: 'activity_identity_missing' };
            const emptyCleanupResult = await config.activityModel.updateOne(
                emptyActivityCasFilter,
                { $unset: buildLegacyStreamUnset() },
                { runValidators: true }
            );
            if (!updateMatched(emptyCleanupResult)) continue;
            const emptyCleanupError = await verifyLegacyStreamsRemoved(config, currentActivity._id);
            return emptyCleanupError
                ? { status: 'failed', reason: emptyCleanupError }
                : { status: 'migrated', reason: 'empty_legacy_fields_cleaned' };
        }
        const record = buildStreamRecord(config, currentActivity, streamData, existingStream);
        const writtenStream = await writeStreamWithCas(config, filter, existingStream, record);
        if (!writtenStream) continue;
        if (streamHash(writtenStream.stream_data) !== streamHash(streamData)) {
            return { status: 'failed', reason: 'stream_verification_failed' };
        }

        const artifacts = buildStreamArtifacts(streamData);
        const activityFields = buildActivityStreamFields(streamData, record);
        const previewSourceUpdatedAt = streamRecordTimestamp(writtenStream);
        if (previewSourceUpdatedAt) {
            activityFields.stream_preview_source_updated_at = previewSourceUpdatedAt;
        }
        if (artifacts.summary_polyline) {
            activityFields.summary_polyline = currentActivity.summary_polyline || artifacts.summary_polyline;
            activityFields.map_summary_polyline = currentActivity.map_summary_polyline || artifacts.summary_polyline;
        }
        const activityUpdate = { $set: activityFields };
        if (cleanup) {
            activityUpdate.$unset = buildLegacyStreamUnset();
        }
        const activityCasFilter = buildObservedCasFilter(filter, currentActivity);
        if (!activityCasFilter) return { status: 'failed', reason: 'activity_identity_missing' };
        const activityResult = await config.activityModel.updateOne(activityCasFilter, activityUpdate, {
            runValidators: true
        });
        if (!updateMatched(activityResult)) continue;
        if (!cleanup) return { status: 'migrated' };

        const cleanupError = await verifyLegacyStreamsRemoved(config, currentActivity._id);
        if (cleanupError) return { status: 'failed', reason: cleanupError };
        return { status: 'migrated' };
    }
    return { status: 'failed', reason: 'concurrent_update_retry_exhausted' };
}

async function migrateProvider(provider, options = {}) {
    const apply = options === true || Boolean(options.apply);
    const cleanup = options === true || Boolean(options.cleanup);
    const config = buildProviderConfig(provider);
    const summary = { provider, mode: apply ? cleanup ? 'apply-cleanup' : 'apply-copy' : 'dry-run', candidates: 0, migrated: 0, planned: 0,
        skipped: 0, failed: 0, remaining_candidates: null, reasons: {}, indexes: [] };
    summary.indexes = await ensureRequiredIndexes(config, { apply });
    if (!apply) {
        summary.candidates = await config.activityModel.collection.countDocuments(
            buildCandidateFilter(),
            { maxTimeMS: 30000 }
        );
        summary.planned = summary.candidates;
        return summary;
    }
    const activities = config.activityModel.find(buildCandidateFilter())
        .select({
            _id: 1,
            user_slug: 1,
            [config.idField]: 1
        })
        .lean()
        .cursor({ batchSize: 10 });
    for await (const activity of activities) {
        summary.candidates += 1;
        try {
            const result = await migrateActivity(config, activity, { apply, cleanup });
            summary[result.status] = Number(summary[result.status] || 0) + 1;
            if (result.reason) summary.reasons[result.reason] = Number(summary.reasons[result.reason] || 0) + 1;
        } catch (error) {
            summary.failed += 1;
            const reason = error && error.message ? error.message : 'unknown_error';
            summary.reasons[reason] = Number(summary.reasons[reason] || 0) + 1;
        }
    }
    if (cleanup) {
        summary.remaining_candidates = await countRemainingCleanupCandidates(config);
        if (summary.remaining_candidates > 0) {
            summary.reasons.cleanup_candidates_remaining = summary.remaining_candidates;
        }
    }
    return summary;
}

async function run(args = process.argv.slice(2)) {
    const options = parseArguments(args);
    await connectDb(process.env.MONGODB_URI || process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGODB_URI (or legacy MONGO_URI) is required to migrate activity streams.');
    }
    const providers = options.provider === 'all' ? ['strava', 'intervals'] : [options.provider];
    const summaries = [];
    for (const provider of providers) summaries.push(await migrateProvider(provider, options));
    const report = {
        mode: options.apply ? options.cleanup ? 'apply-cleanup' : 'apply-copy' : 'dry-run',
        note: options.apply ? options.cleanup
            ? 'Verified stream copies and removed embedded full/duplicate arrays.'
            : 'Verified stream copies and populated compact previews; legacy arrays were retained for rollback.'
            : 'No writes performed. Required indexes were inspected; re-run with --apply to establish them and migrate.',
        providers: summaries
    };
    console.log('[Activity Stream Migration]\n' + JSON.stringify(report, null, 2));
    if (summaries.some((summary) => summary.failed || Number(summary.remaining_candidates || 0) > 0)) {
        process.exitCode = 1;
    }
    return summaries;
}

if (require.main === module) {
    run().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    }).finally(() => mongoose.disconnect());
}

module.exports = {
    LEGACY_STREAM_FIELDS,
    MIGRATION_CAS_MAX_ATTEMPTS,
    streamHash,
    parseArguments,
    buildCandidateFilter,
    countRemainingCleanupCandidates,
    REQUIRED_INDEX_DEFINITIONS,
    buildMigrationStreamSources,
    reconcileStreamSources,
    reconcileMigrationStreams,
    buildStreamRecord,
    buildObservedCasFilter,
    indexKeysEqual,
    inspectRequiredIndexes,
    ensureRequiredIndexes,
    migrateActivity,
    migrateProvider,
    run
};
