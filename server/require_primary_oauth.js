const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { connectDb, isMongoConnected, wrapModel } = require('./db');
const getUserModel = require('./models/user');
const { normalizeSlug } = require('./services/connection');

dotenv.config();

async function requirePrimaryOAuthMigration(userStore, slugValue) {
    const slug = normalizeSlug(slugValue);
    if (!slug) {
        throw new Error(`Invalid user slug: ${slugValue}`);
    }
    const user = await userStore.findOne({ slug });
    if (!user) {
        throw new Error(`User not found: ${slug}`);
    }
    if (user.oauth_application === 'primary'
        && user.migration_status === 'complete'
        && user.connection_status === 'connected'
        && user.needs_reconnect !== true) {
        return { slug, action: 'already-primary' };
    }
    await userStore.updateOne({ slug }, {
        connection_status: 'reconnect_required',
        needs_reconnect: true,
        migration_status: 'required',
        sync_status: 'reconnect_required',
        sync_error: 'Authorize Connor\'s primary Strava application to complete migration'
    });
    return { slug, action: 'primary-oauth-required' };
}

async function run() {
    const slugs = process.argv.slice(2).map(normalizeSlug).filter(Boolean);
    if (!slugs.length) {
        throw new Error('Provide at least one slug, for example: npm run migrate:primary-oauth -- michael');
    }
    await connectDb(process.env.MONGODB_URI || process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGODB_URI (or legacy MONGO_URI) is required');
    }
    const userStore = wrapModel(getUserModel());
    for (const slug of slugs) {
        const result = await requirePrimaryOAuthMigration(userStore, slug);
        console.log('[Primary OAuth Migration]', result);
    }
    await mongoose.disconnect();
}

if (require.main === module) {
    run().catch(async (error) => {
        console.error(error && error.message ? error.message : error);
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect().catch(() => {});
        }
        process.exit(1);
    });
}

module.exports = { requirePrimaryOAuthMigration };
