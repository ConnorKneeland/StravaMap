require('dotenv').config();

const { connectDb, isMongoConnected, memoryStore, wrapModel } = require('./db');
const getActivityModel = require('./models/activity');
const { backfillActivityLocations } = require('./services/location_geocode');

function getActivityStore() {
    return isMongoConnected() ? wrapModel(getActivityModel()) : memoryStore.activities;
}

async function run() {
    await connectDb(process.env.MONGO_URI || '');
    const activityStore = getActivityStore();
    const userSlug = process.argv[2] || '';
    const limit = Number(process.argv[3] || 0);
    const summary = await backfillActivityLocations(activityStore, {
        userSlug: userSlug || undefined,
        limit: limit || undefined
    });

    console.log('[Strava Location Backfill]', {
        storage: isMongoConnected() ? 'MongoDB' : 'memory',
        user: userSlug || 'all',
        requested: summary.requested,
        updated: summary.updated,
        failed: summary.failed,
        remaining: summary.remaining
    });
}

run().then(function () {
    process.exit(0);
}).catch(function (error) {
    console.error(error);
    process.exit(1);
});
