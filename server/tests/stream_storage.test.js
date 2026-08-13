const test = require('node:test');
const assert = require('node:assert/strict');

const { memoryState, memoryStore, wrapModel } = require('../db');
const {
    PREVIEW_MAX_POINTS,
    LEGACY_ACTIVITY_STREAM_SELECT,
    normalizeCanonicalStreamData,
    extractCanonicalStreamData,
    loadProviderStreamSources,
    buildMergedStreamRecord,
    mergeStreamRecordWithRetry,
    updateActivityStreamPreview,
    encodeCompactPolyline,
    buildStreamArtifacts
} = require('../services/stream_storage');
const {
    LEGACY_STREAM_FIELDS,
    parseArguments,
    streamHash,
    reconcileMigrationStreams,
    ensureRequiredIndexes,
    countRemainingCleanupCandidates,
    migrateActivity
} = require('../migrate_activity_streams');
const { fetchActivityStreams, getActivityStreamStore } = require('../services/sync');

function resetMemory() {
    Object.values(memoryState).forEach((records) => records.splice(0, records.length));
}

test.beforeEach(resetMemory);

test('preview telemetry is synchronized, bounded, and progress-aligns mismatched streams', () => {
    const length = 1000;
    const streams = {
        time: Array.from({ length }, (_, index) => index),
        latlng: Array.from({ length }, (_, index) => [44.9 + index / 100000, -93.2 + index / 100000]),
        heartrate: Array.from({ length }, (_, index) => 120 + index % 20),
        cadence: Array.from({ length }, (_, index) => 80 + index % 10),
        altitude: Array.from({ length: length - 1 }, (_, index) => 250 + index)
    };
    const artifacts = buildStreamArtifacts(streams);
    assert.equal(artifacts.stream_preview.time.length, PREVIEW_MAX_POINTS);
    assert.equal(artifacts.stream_preview.latlng.length, PREVIEW_MAX_POINTS);
    assert.equal(artifacts.stream_preview.heartrate.length, PREVIEW_MAX_POINTS);
    assert.equal(artifacts.stream_preview.cadence, undefined);
    assert.equal(artifacts.stream_preview.altitude.length, PREVIEW_MAX_POINTS);
    assert.equal(artifacts.stream_preview.altitude[0], 250);
    assert.equal(artifacts.stream_preview.altitude.at(-1), 250 + length - 2);
    assert.equal(artifacts.stream_preview.time[0], 0);
    assert.equal(artifacts.stream_preview.time.at(-1), length - 1);
    assert.equal(artifacts.stream_preview_metadata.reference_key, 'latlng');
    assert.equal(artifacts.stream_preview_metadata.alignment, 'normalized_progress');
    assert.equal(artifacts.stream_preview_metadata.original_point_count, length);
    assert.equal(artifacts.stream_preview_metadata.stream_point_counts.altitude, length - 1);
    assert.ok(artifacts.summary_polyline.length > 0);
});

test('canonical normalization unwraps provider stream envelopes without creating legacy mirrors', () => {
    const normalized = normalizeCanonicalStreamData({
        time: { data: [0, 1] },
        latlng: { data: [44.9, 45], data2: [-93.2, -93.1] }
    });
    assert.deepEqual(normalized, {
        time: [0, 1],
        latlng: [[44.9, -93.2], [45, -93.1]]
    });
    assert.equal(normalized.stream_time, undefined);
    assert.equal(normalized.stream_latlng, undefined);
});

test('canonical extraction preserves a populated legacy mirror over an empty canonical array', () => {
    assert.deepEqual(extractCanonicalStreamData({
        stream_data: { latlng: [] },
        stream_latlng: [[44.9, -93.2], [45, -93.1]]
    }).latlng, [[44.9, -93.2], [45, -93.1]]);
});

test('canonical stream-store hits never select embedded activity telemetry', async () => {
    const activitySelects = [];
    const activity = { provider: 'intervals_icu', summary_polyline: 'small-summary' };
    const streamRecord = { stream_data: { time: [0, 1, 2] } };
    const result = await loadProviderStreamSources({
        findOne: async (_filter, options) => {
            activitySelects.push(options.select);
            return activity;
        }
    }, {
        findOne: async () => streamRecord
    }, { user_slug: 'tim', intervals_activity_id: 'i1' }, {
        _id: 0,
        provider: 1,
        summary_polyline: 1
    });

    assert.equal(activitySelects.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(activitySelects[0], 'stream_data'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(activitySelects[0], 'stream_latlng'), false);
    assert.equal(result.activity, activity);
    assert.equal(result.streamSource, streamRecord);
    assert.equal(result.usedLegacyFallback, false);
});

test('stream source loading selects legacy telemetry only after a canonical miss', async () => {
    const activitySelects = [];
    const metadata = { provider: 'intervals_icu' };
    const legacy = { stream_data: { time: [0, 1] }, stream_latlng: [[44.9, -93.2], [45, -93.1]] };
    const result = await loadProviderStreamSources({
        findOne: async (_filter, options) => {
            activitySelects.push(options.select);
            return activitySelects.length === 1 ? metadata : legacy;
        }
    }, {
        findOne: async () => null
    }, { user_slug: 'tim', intervals_activity_id: 'i1' }, {
        _id: 0,
        provider: 1
    });

    assert.equal(activitySelects.length, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(activitySelects[0], 'stream_data'), false);
    assert.deepEqual(activitySelects[1], LEGACY_ACTIVITY_STREAM_SELECT);
    assert.equal(result.streamSource, legacy);
    assert.equal(result.usedLegacyFallback, true);
});

test('runtime stream CAS retries retain concurrent disjoint streams and newest metadata', async () => {
    const identity = { user_slug: 'tim', strava_id: 7 };
    let current = {
        _id: 'stream-7', updatedAt: new Date(1000), ...identity,
        stream_data: { time: [0, 1] },
        stream_keys: ['time'], stream_requested_keys: ['time'],
        stream_metadata: { time: { original_size: 2 } },
        stream_resolution: 'high', stream_series_type: 'time',
        stream_fetched_at: new Date(1000)
    };
    let writes = 0;
    const store = {
        findOne: async () => Object.assign({}, current),
        compareAndSwap: async (_filter, observed, record) => {
            writes += 1;
            if (writes === 1) {
                current = Object.assign({}, current, {
                    updatedAt: new Date(2000),
                    stream_data: { time: [0, 1, 2, 3], heartrate: [140, 141, 142, 143] },
                    stream_keys: ['time', 'heartrate'],
                    stream_requested_keys: ['time', 'heartrate'],
                    stream_metadata: {
                        time: { original_size: 4 }, heartrate: { original_size: 4 }
                    },
                    stream_fetched_at: new Date(3000)
                });
                return null;
            }
            assert.equal(new Date(observed.updatedAt).getTime(), 2000);
            current = Object.assign({}, current, record, { updatedAt: new Date(4000) });
            return Object.assign({}, current);
        },
        insertIfAbsent: async () => { throw new Error('unexpected insert'); }
    };
    const result = await mergeStreamRecordWithRetry(store, identity, null, {
        stream_data: { altitude: [250, 251] },
        stream_requested_keys: ['altitude'],
        stream_metadata: { altitude: { original_size: 2 } },
        stream_resolution: 'high', stream_series_type: 'time',
        stream_fetched_at: new Date(1500)
    });
    assert.equal(writes, 2);
    assert.deepEqual(result.stream_data, {
        time: [0, 1, 2, 3], heartrate: [140, 141, 142, 143], altitude: [250, 251]
    });
    assert.deepEqual(result.stream_requested_keys.sort(), ['altitude', 'heartrate', 'time']);
    assert.deepEqual(Object.keys(result.stream_metadata).sort(), ['altitude', 'heartrate', 'time']);
    assert.equal(new Date(result.stream_fetched_at).getTime(), 3000);
});

test('runtime stream CAS retries a missing-row duplicate insert without dropping the winner', async () => {
    const identity = { user_slug: 'tim', intervals_activity_id: 'insert-race' };
    let current = null;
    let insertAttempts = 0;
    const store = {
        findOne: async () => current && Object.assign({}, current),
        insertIfAbsent: async () => {
            insertAttempts += 1;
            current = {
                _id: 'winner', updatedAt: new Date(1000), ...identity,
                stream_data: { latlng: [[45, -93], [45.1, -93.1]] },
                stream_keys: ['latlng']
            };
            const error = new Error('duplicate');
            error.code = 11000;
            throw error;
        },
        compareAndSwap: async (_filter, _observed, record) => {
            current = Object.assign({}, current, record, { updatedAt: new Date(2000) });
            return Object.assign({}, current);
        }
    };
    const result = await mergeStreamRecordWithRetry(store, identity, {
        stream_data: { time: [0, 1] }
    }, {
        stream_data: { heartrate: [140, 141] }
    });
    assert.equal(insertAttempts, 1);
    assert.deepEqual(result.stream_data, {
        time: [0, 1],
        latlng: [[45, -93], [45.1, -93.1]],
        heartrate: [140, 141]
    });
});

test('runtime stream CAS fails explicitly after its bounded retry budget', async () => {
    let attempts = 0;
    await assert.rejects(() => mergeStreamRecordWithRetry({
        findOne: async () => ({ _id: 'busy', updatedAt: new Date(1000), stream_data: {} }),
        compareAndSwap: async () => { attempts += 1; return null; },
        insertIfAbsent: async () => { throw new Error('unexpected insert'); }
    }, { user_slug: 'tim', strava_id: 70 }, null, {
        stream_data: { time: [0] }
    }, { maxAttempts: 3 }), (error) => error && error.code === 'stream_write_conflict');
    assert.equal(attempts, 3);
});

test('memory stream CAS permits one winner and retries the loser into a union', async () => {
    const identity = { user_slug: 'tim', strava_id: 71 };
    const initial = await memoryStore.activityStreams.insertIfAbsent(Object.assign({}, identity, {
        stream_data: { time: [0, 1] }, stream_keys: ['time']
    }));
    const first = await memoryStore.activityStreams.compareAndSwap(identity, initial, Object.assign({}, identity, {
        stream_data: { time: [0, 1], altitude: [250, 251] }
    }));
    const stale = await memoryStore.activityStreams.compareAndSwap(identity, initial, Object.assign({}, identity, {
        stream_data: { time: [0, 1], heartrate: [140, 141] }
    }));
    assert.ok(first);
    assert.equal(stale, null);

    const final = await mergeStreamRecordWithRetry(memoryStore.activityStreams, identity, null, {
        stream_data: { heartrate: [140, 141] }, stream_requested_keys: ['heartrate']
    });
    assert.deepEqual(final.stream_data, {
        time: [0, 1], altitude: [250, 251], heartrate: [140, 141]
    });
    await assert.rejects(
        () => memoryStore.activityStreams.insertIfAbsent(Object.assign({}, identity, { stream_data: {} })),
        (error) => error && error.code === 11000
    );
});

test('Mongo store CAS matches identity, document id, and exact observed timestamp without upsert', async () => {
    let receivedFilter;
    let receivedUpdate;
    let receivedOptions;
    const updated = { _id: 'stream-mongo', updatedAt: new Date(2000) };
    const model = {
        findOneAndUpdate: (filter, update, options) => {
            receivedFilter = filter;
            receivedUpdate = update;
            receivedOptions = options;
            return { lean: async () => updated };
        }
    };
    const store = wrapModel(model);
    const observed = { _id: 'stream-mongo', updatedAt: new Date(1000) };
    assert.equal(await store.compareAndSwap(
        { user_slug: 'tim', strava_id: 72 }, observed, { stream_data: { time: [0] } }
    ), updated);
    assert.deepEqual(receivedFilter, {
        user_slug: 'tim', strava_id: 72, _id: 'stream-mongo', updatedAt: new Date(1000)
    });
    assert.deepEqual(receivedUpdate.$set.stream_data, { time: [0] });
    assert.ok(receivedUpdate.$set.updatedAt instanceof Date);
    assert.ok(receivedUpdate.$set.updatedAt.getTime() > observed.updatedAt.getTime());
    assert.equal(receivedOptions.upsert, false);
    assert.equal(receivedOptions.new, true);
    assert.equal(receivedOptions.timestamps, false);
});

test('runtime stream merge replaces incompatible variants instead of mixing samples', () => {
    const merged = buildMergedStreamRecord({ user_slug: 'tim', strava_id: 8 }, null, {
        stream_data: { time: [0, 1, 2], heartrate: [140, 141, 142] },
        stream_requested_keys: ['time', 'heartrate'],
        stream_metadata: { time: { original_size: 3 }, heartrate: { original_size: 3 } },
        stream_resolution: 'high', stream_series_type: 'time'
    }, {
        stream_data: { distance: [0, 10] },
        stream_requested_keys: ['distance'],
        stream_metadata: { distance: { original_size: 2 } },
        stream_resolution: 'low', stream_series_type: 'distance'
    });
    assert.deepEqual(merged.stream_data, { distance: [0, 10] });
    assert.deepEqual(merged.stream_keys, ['distance']);
    assert.deepEqual(merged.stream_requested_keys, ['distance']);
    assert.deepEqual(merged.stream_metadata, { distance: { original_size: 2 } });
    assert.equal(merged.stream_resolution, 'low');
    assert.equal(merged.stream_series_type, 'distance');

    const legacyOnly = buildMergedStreamRecord({ user_slug: 'tim', strava_id: 8 }, {
        stream_data: { time: [0, 1, 2] },
        stream_requested_keys: ['time'],
        stream_resolution: 'high', stream_series_type: 'time',
        stream_fetched_at: new Date(5000)
    }, null, {
        stream_data: { distance: [0, 10] },
        stream_requested_keys: ['distance'],
        stream_resolution: 'low', stream_series_type: 'distance',
        stream_fetched_at: new Date(1000)
    });
    assert.deepEqual(legacyOnly.stream_data, { distance: [0, 10] });
    assert.deepEqual(legacyOnly.stream_requested_keys, ['distance']);
    assert.equal(new Date(legacyOnly.stream_fetched_at).getTime(), 1000);
});

test('out-of-order preview writes cannot replace a newer canonical preview', async () => {
    const identity = { user_slug: 'tim', strava_id: 9 };
    await memoryStore.activities.insertOne(Object.assign({}, identity, {
        user_id: 'tim', name: 'Race Test'
    }));
    const newer = {
        updatedAt: new Date(3000), stream_data: {
            latlng: [[45, -93], [45.1, -93.1]], time: [0, 2]
        }
    };
    const older = {
        updatedAt: new Date(2000), stream_data: {
            latlng: [[44, -92], [44.1, -92.1]], time: [0, 1]
        }
    };
    await updateActivityStreamPreview(memoryStore.activities, identity, newer);
    await updateActivityStreamPreview(memoryStore.activities, identity, older);
    const stored = await memoryStore.activities.findOne(identity);
    assert.deepEqual(stored.stream_preview.latlng, newer.stream_data.latlng);
    assert.equal(new Date(stored.stream_preview_source_updated_at).getTime(), 3000);
});

test('map scalar fields persist even when its preview CAS loses to a newer source', async () => {
    const identity = { user_slug: 'tim', intervals_activity_id: 'map-race' };
    await memoryStore.intervalsActivities.insertOne(Object.assign({}, identity, {
        activity_key: 'intervals_icu:map-race', id: 'map-race', user_id: 'tim', name: 'Map Race',
        stream_preview_source_updated_at: new Date(4000)
    }));
    await updateActivityStreamPreview(memoryStore.intervalsActivities, identity, {
        updatedAt: new Date(3000), stream_data: { latlng: [[45, -93], [45.1, -93.1]] }
    }, {
        fields: { start_latlng: [45, -93], end_latlng: [45.1, -93.1], map_fetched_at: new Date(5000) }
    });
    const stored = await memoryStore.intervalsActivities.findOne(identity);
    assert.deepEqual(stored.start_latlng, [45, -93]);
    assert.deepEqual(stored.end_latlng, [45.1, -93.1]);
    assert.equal(new Date(stored.map_fetched_at).getTime(), 5000);
    assert.equal(new Date(stored.stream_preview_source_updated_at).getTime(), 4000);
});

test('migration reconciliation chooses richer per-key arrays and flags equal-length conflicts', () => {
    const richerEmbedded = reconcileMigrationStreams({
        stream_data: { time: [0, 1, 2, 3], heartrate: [140, 141, 142] }
    }, {
        stream_data: { time: [0, 1], heartrate: [140, 141, 142] }
    });
    assert.deepEqual(richerEmbedded.stream_data.time, [0, 1, 2, 3]);
    assert.deepEqual(richerEmbedded.stream_data.heartrate, [140, 141, 142]);
    assert.deepEqual(richerEmbedded.conflicts, []);

    const conflict = reconcileMigrationStreams({
        stream_data: { time: [0, 1, 2] }
    }, {
        stream_data: { time: [0, 9, 2] }
    });
    assert.equal(conflict.stream_data.time, undefined);
    assert.equal(conflict.conflicts.length, 1);
    assert.equal(conflict.conflicts[0].key, 'time');
});

function createIndexTestConfig(provider, activityIndexes, streamIndexes, options = {}) {
    const makeCollection = (indexes) => ({
        indexes: async () => indexes.map((index) => Object.assign({}, index)),
        createIndex: async (key, settings) => {
            if (options.failCreate === settings.name) throw new Error('simulated index failure');
            indexes.push({ key, name: settings.name, unique: settings.unique === true });
            return settings.name;
        }
    });
    return {
        provider,
        activityModel: { collection: makeCollection(activityIndexes) },
        streamModel: { collection: makeCollection(streamIndexes) }
    };
}

test('migration apply creates and verifies required stream and pagination indexes', async () => {
    const config = createIndexTestConfig('strava', [{ key: { _id: 1 }, name: '_id_' }], []);
    const created = await ensureRequiredIndexes(config, { apply: true });
    assert.deepEqual(created.map((index) => index.status), ['created', 'created']);
    const verified = await ensureRequiredIndexes(config, { apply: true });
    assert.deepEqual(verified.map((index) => index.status), ['verified', 'verified']);
    assert.equal(verified[0].unique, true);
});

test('migration dry-run reports missing indexes without creating them', async () => {
    const config = createIndexTestConfig('intervals', [], []);
    const inspected = await ensureRequiredIndexes(config, { apply: false });
    assert.deepEqual(inspected.map((index) => index.status), ['missing', 'missing']);
    const inspectedAgain = await ensureRequiredIndexes(config, { apply: false });
    assert.deepEqual(inspectedAgain.map((index) => index.status), ['missing', 'missing']);
});

test('migration fails safely for incompatible or uncreatable required indexes', async () => {
    const incompatible = createIndexTestConfig('intervals', [], [{
        key: { user_slug: 1, intervals_activity_id: 1 },
        name: 'non_unique_stream_identity'
    }]);
    await assert.rejects(() => ensureRequiredIndexes(incompatible, { apply: true }), /incompatible/);

    const failed = createIndexTestConfig('strava', [], [], {
        failCreate: 'activity_streams_user_slug_strava_id_unique'
    });
    await assert.rejects(() => ensureRequiredIndexes(failed, { apply: true }), /Could not establish/);
});

test('cleanup recount uses the legacy candidate filter and a bounded database read', async () => {
    let receivedFilter;
    let receivedOptions;
    const remaining = await countRemainingCleanupCandidates({
        activityModel: {
            collection: {
                countDocuments: async (filter, options) => {
                    receivedFilter = filter;
                    receivedOptions = options;
                    return 2;
                }
            }
        }
    });
    assert.equal(remaining, 2);
    assert.deepEqual(receivedFilter, {
        $or: [
            { stream_data: { $exists: true } },
            { stream_latlng: { $exists: true } },
            { stream_velocity_smooth: { $exists: true } },
            { stream_time: { $exists: true } }
        ]
    });
    assert.deepEqual(receivedOptions, { maxTimeMS: 30000 });
});

test('cleanup stops before any write when equal-length canonical sources conflict', async () => {
    let streamWriteCount = 0;
    let activityWriteCount = 0;
    const config = {
        idField: 'strava_id',
        providerValue: undefined,
        streamModel: {
            findOne: () => ({
                lean: async () => ({ stream_data: { time: [0, 9, 2] } })
            }),
            findOneAndUpdate: () => {
                streamWriteCount += 1;
                return { lean: async () => ({}) };
            }
        },
        activityModel: {
            findOne: () => ({
                select: () => ({
                    lean: async () => ({
                        _id: 'activity-1', updatedAt: new Date(0), user_slug: 'tim', strava_id: 1,
                        stream_data: { time: [0, 1, 2] }
                    })
                })
            }),
            updateOne: async () => { activityWriteCount += 1; return { matchedCount: 1 }; },
            collection: { findOne: async () => ({}) }
        }
    };
    const result = await migrateActivity(config, {
        _id: 'activity-1', user_slug: 'tim', strava_id: 1,
        stream_data: { time: [0, 1, 2] }
    }, { apply: true, cleanup: true });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /stream_conflict:time/);
    assert.equal(streamWriteCount, 0);
    assert.equal(activityWriteCount, 0);
});

test('cleanup removes empty legacy stream fields without creating a canonical stream', async () => {
    const identity = { user_slug: 'tim', strava_id: 404 };
    let currentActivity = {
        _id: 'activity-empty', updatedAt: new Date(1000), ...identity,
        stream_data: {}, stream_latlng: [], stream_velocity_smooth: [], stream_time: []
    };
    let streamWriteCount = 0;
    const config = {
        idField: 'strava_id',
        providerValue: undefined,
        streamModel: {
            findOne: () => ({ lean: async () => null }),
            create: async () => { streamWriteCount += 1; return {}; },
            findOneAndUpdate: () => { streamWriteCount += 1; return { lean: async () => ({}) }; }
        },
        activityModel: {
            findOne: () => ({ select: () => ({ lean: async () => Object.assign({}, currentActivity) }) }),
            updateOne: async (_filter, update) => {
                Object.keys(update.$unset || {}).forEach((field) => delete currentActivity[field]);
                return { matchedCount: 1 };
            },
            collection: { findOne: async () => Object.assign({}, currentActivity) }
        }
    };

    const result = await migrateActivity(config, currentActivity, { apply: true, cleanup: true });
    assert.equal(result.status, 'migrated');
    assert.equal(result.reason, 'empty_legacy_fields_cleaned');
    assert.equal(streamWriteCount, 0);
    LEGACY_STREAM_FIELDS.forEach((field) => {
        assert.equal(Object.prototype.hasOwnProperty.call(currentActivity, field), false);
    });
});

test('migration retries a stream CAS miss and preserves the concurrent richer stream', async () => {
    const identity = { user_slug: 'tim', strava_id: 1 };
    const initialActivity = {
        _id: 'activity-1', updatedAt: new Date(1000), ...identity,
        stream_data: { time: [0, 1] },
        stream_requested_keys: ['time'],
        stream_metadata: { activity: true }
    };
    let currentStream = {
        _id: 'stream-1', updatedAt: new Date(1000), ...identity,
        stream_data: { time: [0] },
        stream_requested_keys: ['time'],
        stream_metadata: { old: true },
        stream_fetched_at: new Date(1000)
    };
    let streamReads = 0;
    let streamWriteAttempts = 0;
    let activityWriteCount = 0;
    const config = {
        idField: 'strava_id',
        providerValue: undefined,
        streamModel: {
            findOne: () => ({ lean: async () => {
                streamReads += 1;
                return Object.assign({}, currentStream);
            } }),
            findOneAndUpdate: (filter, update) => ({ lean: async () => {
                streamWriteAttempts += 1;
                if (streamWriteAttempts === 1) {
                    currentStream = {
                        _id: 'stream-1', updatedAt: new Date(2000), ...identity,
                        stream_data: { time: [0, 1, 2, 3] },
                        stream_requested_keys: ['time'],
                        stream_metadata: { concurrent: true },
                        stream_fetched_at: new Date(2000)
                    };
                    return null;
                }
                assert.deepEqual(filter.updatedAt, new Date(2000));
                currentStream = Object.assign({}, currentStream, update.$set, { updatedAt: new Date(3000) });
                return Object.assign({}, currentStream);
            } }),
            create: async () => { throw new Error('unexpected insert'); }
        },
        activityModel: {
            findOne: () => ({
                select: () => ({ lean: async () => Object.assign({}, initialActivity) })
            }),
            updateOne: async () => {
                activityWriteCount += 1;
                return { matchedCount: 1 };
            },
            collection: { findOne: async () => ({ _id: initialActivity._id }) }
        }
    };

    const result = await migrateActivity(config, initialActivity, { apply: true, cleanup: false });
    assert.equal(result.status, 'migrated');
    assert.equal(streamWriteAttempts, 2);
    assert.ok(streamReads >= 2);
    assert.deepEqual(currentStream.stream_data.time, [0, 1, 2, 3]);
    assert.deepEqual(currentStream.stream_metadata, { activity: true, concurrent: true });
    assert.equal(new Date(currentStream.stream_fetched_at).getTime(), 2000);
    assert.equal(activityWriteCount, 1);
});

test('migration retries an activity CAS miss before cleanup and rereads embedded streams', async () => {
    const identity = { user_slug: 'tim', strava_id: 2 };
    let currentActivity = {
        _id: 'activity-2', updatedAt: new Date(1000), ...identity,
        stream_data: { time: [0, 1] }
    };
    let currentStream = null;
    let activityReads = 0;
    let activityWriteAttempts = 0;
    const config = {
        idField: 'strava_id',
        providerValue: undefined,
        streamModel: {
            findOne: () => ({ lean: async () => currentStream && Object.assign({}, currentStream) }),
            create: async (record) => {
                currentStream = Object.assign({ _id: 'stream-2', updatedAt: new Date(1500) }, record);
                return Object.assign({}, currentStream);
            },
            findOneAndUpdate: (_filter, update) => ({ lean: async () => {
                currentStream = Object.assign({}, currentStream, update.$set, { updatedAt: new Date(2500) });
                return Object.assign({}, currentStream);
            } })
        },
        activityModel: {
            findOne: () => ({ select: () => ({ lean: async () => {
                activityReads += 1;
                return Object.assign({}, currentActivity);
            } }) }),
            updateOne: async (_filter, update) => {
                activityWriteAttempts += 1;
                if (activityWriteAttempts === 1) {
                    currentActivity = Object.assign({}, currentActivity, {
                        updatedAt: new Date(2000),
                        stream_data: { time: [0, 1, 2] }
                    });
                    return { matchedCount: 0 };
                }
                currentActivity = Object.assign({}, currentActivity, update.$set);
                Object.keys(update.$unset || {}).forEach((key) => delete currentActivity[key]);
                return { matchedCount: 1 };
            },
            collection: { findOne: async () => Object.assign({}, currentActivity) }
        }
    };

    const result = await migrateActivity(config, currentActivity, { apply: true, cleanup: true });
    assert.equal(result.status, 'migrated');
    assert.equal(activityWriteAttempts, 2);
    assert.ok(activityReads >= 2);
    assert.deepEqual(currentStream.stream_data.time, [0, 1, 2]);
    assert.equal(Object.prototype.hasOwnProperty.call(currentActivity, 'stream_data'), false);
});

test('compact route encoding uses the standard Google polyline representation', () => {
    assert.equal(
        encodeCompactPolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]),
        '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
    );
});

test('memory stores support compound ordering, cursor filters, projections, and provider-separated keys', async () => {
    await memoryStore.activities.insertOne({ strava_id: 1, user_slug: 'tim', start_date: 2, name: 'later', secret: 1 });
    await memoryStore.activities.insertOne({ strava_id: 2, user_slug: 'tim', start_date: 2, name: 'tie', secret: 2 });
    await memoryStore.activities.insertOne({ strava_id: 3, user_slug: 'tim', start_date: 1, name: 'earlier', secret: 3 });
    const page = await memoryStore.activities.find({
        user_slug: 'tim',
        $or: [{ start_date: { $lt: 2 } }, { start_date: 2, strava_id: { $lt: 2 } }],
        name: { $ne: 'missing' }
    }, { sort: { start_date: -1, strava_id: -1 }, select: { strava_id: 1, name: 1, _id: 0 } });
    assert.deepEqual(page, [
        { strava_id: 1, name: 'later' },
        { strava_id: 3, name: 'earlier' }
    ]);

    await memoryStore.activityStreams.upsertOne({ user_slug: 'tim', strava_id: 1 }, { stream_data: { time: [0] } });
    await memoryStore.activityStreams.upsertOne({ user_slug: 'lee', strava_id: 1 }, { stream_data: { time: [1] } });
    await memoryStore.intervalsActivityStreams.upsertOne(
        { user_slug: 'tim', intervals_activity_id: 'i1' }, { stream_data: { time: [2] } }
    );
    assert.equal(await memoryStore.activityStreams.count({ strava_id: 1 }), 2);
    assert.equal(await memoryStore.intervalsActivityStreams.count({ intervals_activity_id: 'i1' }), 1);
});

test('migration arguments default to dry-run and stream verification hashes are key-order independent', () => {
    assert.deepEqual(parseArguments([]), { apply: false, cleanup: false, provider: 'all' });
    assert.deepEqual(parseArguments(['--apply', '--provider=intervals']), {
        apply: true, cleanup: false, provider: 'intervals'
    });
    assert.deepEqual(parseArguments(['--apply', '--cleanup', '--provider=strava']), {
        apply: true, cleanup: true, provider: 'strava'
    });
    assert.throws(() => parseArguments(['--cleanup']), /requires --apply/);
    assert.equal(streamHash({ time: [0, 1], latlng: [[1, 2], [3, 4]] }),
        streamHash({ latlng: [[1, 2], [3, 4]], time: [0, 1] }));
    assert.throws(() => parseArguments(['--provider=combined']), /all, strava, or intervals/);
});

test('Strava stream hydration writes canonical full streams separately and only a preview on the activity', async () => {
    const user = await memoryStore.users.insertOne({
        slug: 'tim',
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        token_expires: new Date(Date.now() + 3600000),
        connection_status: 'connected'
    });
    await memoryStore.activities.insertOne({
        strava_id: 99,
        user_slug: 'tim',
        user_id: 'tim',
        name: 'Preview Run',
        summary_polyline: 'provider-summary'
    });
    const originalFetch = global.fetch;
    global.fetch = async () => Response.json({
        time: { data: [0, 1, 2], resolution: 'high', series_type: 'time' },
        latlng: { data: [[44.9, -93.2], [44.91, -93.19], [44.92, -93.18]] },
        velocity_smooth: { data: [2, 3, 4] }
    });
    try {
        await fetchActivityStreams(user, 99, {
            keys: ['time', 'latlng', 'velocity_smooth'], resolution: 'high', seriesType: 'time'
        });
    } finally {
        global.fetch = originalFetch;
    }
    const activity = await memoryStore.activities.findOne({ user_slug: 'tim', strava_id: 99 });
    const fullStreams = await getActivityStreamStore().findOne({ user_slug: 'tim', strava_id: 99 });
    assert.equal(activity.stream_data, undefined);
    assert.equal(activity.stream_latlng, undefined);
    assert.deepEqual(activity.stream_preview.time, [0, 1, 2]);
    assert.deepEqual(fullStreams.stream_data.velocity_smooth, [2, 3, 4]);
    assert.equal(activity.summary_polyline, 'provider-summary');
});
