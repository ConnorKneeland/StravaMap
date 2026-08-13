const mongoose = require('mongoose');

const memoryState = {
    users: [],
    activities: [],
    competitions: [],
    collections: [],
    activityNotes: [],
    activityKpiSnapshots: [],
    intervalsActivities: [],
    activityStreams: [],
    intervalsActivityStreams: [],
    intervalsActivityKpiSnapshots: [],
    providerConnections: [],
    oauthStates: [],
    webhookEvents: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getValue(document, key) {
    return key.split('.').reduce((current, part) => (current == null ? undefined : current[part]), document);
}

function matchesValue(value, expected) {
    const comparableValue = (candidate, reference) => {
        if (reference instanceof Date) {
            const timestamp = candidate instanceof Date
                ? candidate.getTime()
                : new Date(candidate).getTime();
            return Number.isNaN(timestamp) ? candidate : timestamp;
        }
        return candidate;
    };
    if (expected instanceof Date) {
        return comparableValue(value, expected) === expected.getTime();
    }
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if (Object.prototype.hasOwnProperty.call(expected, '$in')) {
            return expected.$in.includes(value);
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$gte')
            && comparableValue(value, expected.$gte) < comparableValue(expected.$gte, expected.$gte)) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$gt')
            && comparableValue(value, expected.$gt) <= comparableValue(expected.$gt, expected.$gt)) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$lte')
            && comparableValue(value, expected.$lte) > comparableValue(expected.$lte, expected.$lte)) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$lt')
            && comparableValue(value, expected.$lt) >= comparableValue(expected.$lt, expected.$lt)) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$ne') && value === expected.$ne) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$exists')
            && Boolean(value !== undefined) !== Boolean(expected.$exists)) {
            return false;
        }
        return true;
    }
    return value === expected;
}

function matchesFilter(document, filter) {
    return Object.entries(filter || {}).every(([key, expected]) => {
        if (key === '$or') {
            return Array.isArray(expected) && expected.some((condition) => matchesFilter(document, condition));
        }
        if (key === '$and') {
            return Array.isArray(expected) && expected.every((condition) => matchesFilter(document, condition));
        }
        return matchesValue(getValue(document, key), expected);
    });
}

function applySort(items, sort) {
    if (!sort) {
        return items;
    }
    const fields = Object.entries(sort);
    return items.slice().sort((left, right) => {
        for (const [field, direction] of fields) {
            const leftValue = getValue(left, field);
            const rightValue = getValue(right, field);
            if (leftValue === rightValue) continue;
            if (leftValue > rightValue) return direction >= 0 ? 1 : -1;
            return direction >= 0 ? -1 : 1;
        }
        return 0;
    });
}

function setValue(document, key, value) {
    const parts = key.split('.');
    let current = document;
    parts.forEach((part, index) => {
        if (index === parts.length - 1) {
            current[part] = value;
            return;
        }
        if (!current[part] || typeof current[part] !== 'object') current[part] = {};
        current = current[part];
    });
}

function deleteValue(document, key) {
    const parts = key.split('.');
    const leaf = parts.pop();
    const parent = parts.reduce((current, part) => current && current[part], document);
    if (parent && typeof parent === 'object') delete parent[leaf];
}

function applyProjection(document, select) {
    if (!select) return document;
    const projection = typeof select === 'string'
        ? String(select).trim().split(/\s+/).filter(Boolean).reduce((result, field) => {
            const excluded = field.startsWith('-');
            result[excluded ? field.slice(1) : field] = excluded ? 0 : 1;
            return result;
        }, {})
        : select;
    const entries = Object.entries(projection || {});
    const inclusive = entries.some(([field, enabled]) => field !== '_id' && Boolean(enabled));
    if (inclusive) {
        const projected = {};
        for (const [field, enabled] of entries) {
            if (!enabled) continue;
            const value = getValue(document, field);
            if (value !== undefined) setValue(projected, field, value);
        }
        if (projection._id !== 0 && document._id !== undefined) projected._id = document._id;
        return projected;
    }
    const projected = clone(document);
    for (const [field, enabled] of entries) {
        if (!enabled) deleteValue(projected, field);
    }
    return projected;
}

function normalizeUpdate(update) {
    return update && update.$set ? update.$set : update;
}

let memoryTimestamp = Date.now();

function nextMemoryTimestamp(currentValue) {
    const currentTimestamp = currentValue ? new Date(currentValue).getTime() : 0;
    memoryTimestamp = Math.max(Date.now(), memoryTimestamp + 1, Number.isNaN(currentTimestamp) ? 0 : currentTimestamp + 1);
    return new Date(memoryTimestamp);
}

function sameTimestamp(left, right) {
    if (left === undefined || left === null || right === undefined || right === null) {
        return left === right;
    }
    const leftTime = new Date(left).getTime();
    const rightTime = new Date(right).getTime();
    return !Number.isNaN(leftTime) && !Number.isNaN(rightTime)
        ? leftTime === rightTime
        : left === right;
}

function duplicateKeyError() {
    const error = new Error('Duplicate key');
    error.code = 11000;
    return error;
}

function createMemoryCollection(name, uniqueField) {
    return {
        async find(filter = {}, options = {}) {
            let items = memoryState[name].filter((item) => matchesFilter(item, filter));
            items = applySort(items, options.sort);
            if (typeof options.limit === 'number') {
                items = items.slice(0, options.limit);
            }
            return clone(items.map((item) => applyProjection(item, options.select)));
        },
        async findOne(filter = {}, options = {}) {
            const items = await this.find(filter, Object.assign({}, options, { limit: 1 }));
            return items[0] || null;
        },
        async count(filter = {}) {
            return memoryState[name].filter((item) => matchesFilter(item, filter)).length;
        },
        async insertOne(document) {
            const next = Object.assign({}, clone(document), {
                _id: document._id || `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
            });
            if (uniqueField) {
                const uniqueFields = Array.isArray(uniqueField) ? uniqueField : [uniqueField];
                const existingIndex = memoryState[name].findIndex((item) => uniqueFields.every((field) => (
                    item[field] === next[field]
                )));
                if (existingIndex !== -1) {
                    memoryState[name][existingIndex] = next;
                    return clone(next);
                }
            }
            memoryState[name].push(next);
            return clone(next);
        },
        async insertIfAbsent(document) {
            const uniqueFields = Array.isArray(uniqueField) ? uniqueField : [uniqueField];
            if (uniqueField && memoryState[name].some((item) => uniqueFields.every((field) => (
                item[field] === document[field]
            )))) {
                throw duplicateKeyError();
            }
            const timestamp = nextMemoryTimestamp(document.updatedAt);
            const next = Object.assign({}, clone(document), {
                _id: document._id || `${name}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
                createdAt: document.createdAt || timestamp,
                updatedAt: timestamp
            });
            memoryState[name].push(next);
            return clone(next);
        },
        async compareAndSwap(filter, observed, update) {
            const index = memoryState[name].findIndex((item) => matchesFilter(item, filter));
            if (index === -1) return null;
            const current = memoryState[name][index];
            if (!observed || current._id !== observed._id
                || !sameTimestamp(current.updatedAt, observed.updatedAt)) {
                return null;
            }
            const nextUpdate = normalizeUpdate(update);
            memoryState[name][index] = Object.assign({}, current, clone(nextUpdate), {
                updatedAt: nextMemoryTimestamp(current.updatedAt)
            });
            return clone(memoryState[name][index]);
        },
        async updateOne(filter, update) {
            const nextUpdate = normalizeUpdate(update);
            const index = memoryState[name].findIndex((item) => matchesFilter(item, filter));
            if (index === -1) {
                return null;
            }
            memoryState[name][index] = Object.assign({}, memoryState[name][index], clone(nextUpdate));
            return clone(memoryState[name][index]);
        },
        async upsertOne(filter, update) {
            const nextUpdate = normalizeUpdate(update);
            const existing = await this.updateOne(filter, nextUpdate);
            if (existing) {
                return existing;
            }
            return this.insertOne(Object.assign({}, filter, nextUpdate));
        },
        async deleteOne(filter) {
            const index = memoryState[name].findIndex((item) => matchesFilter(item, filter));
            if (index === -1) {
                return null;
            }
            const [removed] = memoryState[name].splice(index, 1);
            return clone(removed);
        },
        async bulkUpsertActivities(documents) {
            if (!documents.length) {
                return {
                    records: [],
                    insertedCount: 0,
                    updatedCount: 0,
                    totalCount: 0
                };
            }
            const stravaIds = documents.map((document) => document.strava_id);
            const existingIds = new Set(
                memoryState[name]
                    .filter((item) => stravaIds.includes(item.strava_id))
                    .map((item) => item.strava_id)
            );
            for (const document of documents) {
                await this.upsertOne({ strava_id: document.strava_id }, document);
            }
            const insertedCount = documents.reduce((count, document) => {
                return count + (existingIds.has(document.strava_id) ? 0 : 1);
            }, 0);
            return {
                records: await this.find({ strava_id: { $in: stravaIds } }),
                insertedCount: insertedCount,
                updatedCount: documents.length - insertedCount,
                totalCount: documents.length
            };
        }
    };
}

function wrapModel(model) {
    return {
        async find(filter = {}, options = {}) {
            let query = model.find(filter);
            if (options.select) {
                query = query.select(options.select);
            }
            if (options.sort) {
                query = query.sort(options.sort);
            }
            if (typeof options.limit === 'number') {
                query = query.limit(options.limit);
            }
            return query.lean();
        },
        async findOne(filter = {}, options = {}) {
            let query = model.findOne(filter);
            if (options.select) {
                query = query.select(options.select);
            }
            if (options.sort) {
                query = query.sort(options.sort);
            }
            return query.lean();
        },
        async count(filter = {}) {
            return model.countDocuments(filter);
        },
        async insertOne(document) {
            const created = await model.create(document);
            return created.toObject();
        },
        async insertIfAbsent(document) {
            const created = await model.create(document);
            return created.toObject();
        },
        async compareAndSwap(filter, observed, update) {
            if (!observed || observed._id === undefined || observed._id === null) return null;
            const casFilter = Object.assign({}, filter, { _id: observed._id });
            if (!Object.prototype.hasOwnProperty.call(observed, 'updatedAt') || observed.updatedAt === undefined) {
                casFilter.updatedAt = { $exists: false };
            } else if (observed.updatedAt === null) {
                casFilter.updatedAt = { $eq: null, $exists: true };
            } else {
                casFilter.updatedAt = observed.updatedAt;
            }
            const observedTimestamp = observed.updatedAt ? new Date(observed.updatedAt).getTime() : 0;
            const nextTimestamp = new Date(Math.max(
                Date.now(),
                Number.isNaN(observedTimestamp) ? 0 : observedTimestamp + 1
            ));
            const nextUpdate = Object.assign({}, normalizeUpdate(update), { updatedAt: nextTimestamp });
            return model.findOneAndUpdate(casFilter, { $set: nextUpdate }, {
                new: true,
                upsert: false,
                runValidators: true,
                timestamps: false
            }).lean();
        },
        async updateOne(filter, update) {
            return model.findOneAndUpdate(filter, { $set: normalizeUpdate(update) }, { new: true }).lean();
        },
        async upsertOne(filter, update) {
            return model.findOneAndUpdate(filter, { $set: normalizeUpdate(update) }, {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true
            }).lean();
        },
        async deleteOne(filter) {
            return model.findOneAndDelete(filter).lean();
        },
        async bulkUpsertActivities(documents) {
            if (!documents.length) {
                return {
                    records: [],
                    insertedCount: 0,
                    updatedCount: 0,
                    totalCount: 0
                };
            }
            const stravaIds = documents.map((document) => document.strava_id);
            const existingRecords = await model.find({ strava_id: { $in: stravaIds } }).select({ strava_id: 1 }).lean();
            const existingIds = new Set(existingRecords.map((record) => record.strava_id));
            await model.bulkWrite(documents.map((document) => ({
                updateOne: {
                    filter: { strava_id: document.strava_id },
                    update: { $set: document },
                    upsert: true
                }
            })));
            const insertedCount = documents.reduce((count, document) => {
                return count + (existingIds.has(document.strava_id) ? 0 : 1);
            }, 0);
            return {
                records: await model.find({ strava_id: { $in: stravaIds } }).lean(),
                insertedCount: insertedCount,
                updatedCount: documents.length - insertedCount,
                totalCount: documents.length
            };
        }
    };
}

async function connectDb(mongoUri) {
    if (!mongoUri) {
        return false;
    }
    await mongoose.connect(mongoUri);
    return true;
}

function isMongoConnected() {
    return mongoose.connection.readyState === 1;
}

const memoryStore = {
    users: createMemoryCollection('users', 'slug'),
    activities: createMemoryCollection('activities', 'strava_id'),
    competitions: createMemoryCollection('competitions', 'id'),
    collections: createMemoryCollection('collections', 'id'),
    activityNotes: createMemoryCollection('activityNotes', 'id'),
    activityKpiSnapshots: createMemoryCollection('activityKpiSnapshots', 'id'),
    intervalsActivities: createMemoryCollection('intervalsActivities', 'activity_key'),
    activityStreams: createMemoryCollection('activityStreams', ['user_slug', 'strava_id']),
    intervalsActivityStreams: createMemoryCollection(
        'intervalsActivityStreams', ['user_slug', 'intervals_activity_id']
    ),
    intervalsActivityKpiSnapshots: createMemoryCollection('intervalsActivityKpiSnapshots', 'id'),
    providerConnections: createMemoryCollection('providerConnections', 'connection_key'),
    oauthStates: createMemoryCollection('oauthStates', 'state_hash'),
    webhookEvents: createMemoryCollection('webhookEvents', 'event_key')
};

module.exports = {
    connectDb,
    isMongoConnected,
    memoryStore,
    wrapModel,
    memoryState
};
