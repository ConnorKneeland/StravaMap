const dotenv = require('dotenv');
const { connectDb, isMongoConnected } = require('./db');
const { getAllFrontendUsers } = require('./frontend_user_configs');
const { ensureUserForSync, syncUserActivities } = require('./services/sync');

dotenv.config();

async function bulkSyncUsers() {
    await connectDb(process.env.MONGO_URI || '');
    const configuredUsers = getAllFrontendUsers();
    console.log('[Strava Bulk Sync]', {
        configuredUsers: configuredUsers.map((user) => user.slug),
        storage: isMongoConnected() ? 'MongoDB' : 'memory'
    });

    for (const configuredUser of configuredUsers) {
        const user = await ensureUserForSync(configuredUser.slug);
        if (!user) {
            console.log('[Strava Bulk Sync]', {
                action: 'skipped',
                user: configuredUser.slug,
                reason: 'User not found in frontend config'
            });
            continue;
        }
        const summary = await syncUserActivities(user);
        console.log('[Strava Bulk Sync]', {
            user: configuredUser.slug,
            recordsInserted: summary.recordsInserted,
            recordsUpdated: summary.recordsUpdated,
            stravaRecordsPulled: summary.stravaRecordsPulled,
            storedActivityCount: summary.storedActivityCount
        });
    }
}

bulkSyncUsers().then(function () {
    process.exit(0);
}).catch(function (error) {
    console.error(error);
    process.exit(1);
});
