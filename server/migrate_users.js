const dotenv = require('dotenv');
const { connectDb, isMongoConnected, wrapModel } = require('./db');
const getUserModel = require('./models/user');
const { getAllFrontendUsers } = require('./frontend_user_configs');

dotenv.config();

async function migrate() {
    await connectDb(process.env.MONGODB_URI || process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGODB_URI (or legacy MONGO_URI) is required to migrate users into MongoDB.');
    }
    const store = wrapModel(getUserModel());
    for (const user of getAllFrontendUsers()) {
        const existing = await store.findOne({ slug: user.slug });
        const publicConfig = {
            display_name: user.display_name,
            slug: user.slug,
            color: user.color,
            default_lat: user.default_lat,
            default_lng: user.default_lng,
            num_pages: user.num_pages
        };
        const migrationFields = existing ? {
            connection_status: existing.connection_status || (existing.refresh_token ? 'connected' : 'not_connected'),
            needs_reconnect: existing.needs_reconnect === true,
            oauth_application: existing.oauth_application || 'legacy',
            migration_status: existing.migration_status || (existing.refresh_token ? 'pending' : 'not_started'),
            sync_status: existing.sync_status || 'idle',
            backfill_complete: existing.backfill_complete === true
        } : {
            connection_status: user.refresh_token ? 'connected' : 'not_connected',
            needs_reconnect: false,
            oauth_application: 'legacy',
            migration_status: user.refresh_token ? 'pending' : 'not_started',
            sync_status: 'idle',
            backfill_complete: false
        };
        if (existing) {
            await store.updateOne({ slug: user.slug }, Object.assign({}, publicConfig, migrationFields));
        } else {
            await store.insertOne(Object.assign({}, user, migrationFields));
        }
    }
    console.log('Users migrated.');
    process.exit(0);
}

migrate().catch((error) => {
    console.error(error);
    process.exit(1);
});
