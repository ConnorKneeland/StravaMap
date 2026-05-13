const mongoose = require('mongoose');

const memoryState = {
    users: [],
    activities: [],
    competitions: [],
    collections: [],
    activityNotes: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getValue(document, key) {
    return key.split('.').reduce((current, part) => (current == null ? undefined : current[part]), document);
}

function matchesValue(value, expected) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if (Object.prototype.hasOwnProperty.call(expected, '$in')) {
            return expected.$in.includes(value);
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$gte') && value < expected.$gte) {
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(expected, '$lte') && value > expected.$lte) {
            return false;
        }
        return true;
    }
    return value === expected;
}

function matchesFilter(document, filter) {
    return Object.entries(filter || {}).every(([key, expected]) => {
        return matchesValue(getValue(document, key), expected);
    });
}

function applySort(items, sort) {
    if (!sort) {
        return items;
    }
    const [field, direction] = Object.entries(sort)[0];
    return items.slice().sort((left, right) => {
        const leftValue = getValue(left, field);
        const rightValue = getValue(right, field);
        if (leftValue === rightValue) {
            return 0;
        }
        if (leftValue > rightValue) {
            return direction >= 0 ? 1 : -1;
        }
        return direction >= 0 ? -1 : 1;
    });
}

function normalizeUpdate(update) {
    return update && update.$set ? update.$set : update;
}

function createMemoryCollection(name, uniqueField) {
    return {
        async find(filter = {}, options = {}) {
            let items = memoryState[name].filter((item) => matchesFilter(item, filter));
            items = applySort(items, options.sort);
            if (typeof options.limit === 'number') {
                items = items.slice(0, options.limit);
            }
            return clone(items);
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
                const existingIndex = memoryState[name].findIndex((item) => item[uniqueField] === next[uniqueField]);
                if (existingIndex !== -1) {
                    memoryState[name][existingIndex] = next;
                    return clone(next);
                }
            }
            memoryState[name].push(next);
            return clone(next);
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
    activityNotes: createMemoryCollection('activityNotes', 'id')
};

module.exports = {
    connectDb,
    isMongoConnected,
    memoryStore,
    wrapModel,
    memoryState
};
