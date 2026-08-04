const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { connectDb, isMongoConnected, wrapModel } = require('./db');
const getUserModel = require('./models/user');
const { normalizeSlug } = require('./services/connection');

dotenv.config();

const ALL_EXISTING_FLAG = '--all-existing';
const CAMPAIGN_EXCLUDED_SLUGS = Object.freeze(['connor', 'tim']);

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

async function requireAllExistingPrimaryOAuthMigrations(userStore) {
    const excludedSlugs = new Set(CAMPAIGN_EXCLUDED_SLUGS);
    const users = await userStore.find({}, { sort: { slug: 1 } });
    const results = [];
    for (const user of users) {
        const slug = normalizeSlug(user && user.slug);
        if (!slug) {
            continue;
        }
        if (excludedSlugs.has(slug)) {
            results.push({ slug, action: 'excluded' });
            continue;
        }
        results.push(await requirePrimaryOAuthMigration(userStore, slug));
    }
    return {
        totalExistingUsers: users.length,
        excludedSlugs: CAMPAIGN_EXCLUDED_SLUGS.slice(),
        primaryOAuthRequired: results.filter((result) => result.action === 'primary-oauth-required').length,
        alreadyPrimary: results.filter((result) => result.action === 'already-primary').length,
        results
    };
}

async function run() {
    const args = process.argv.slice(2);
    const runAllExistingCampaign = args.includes(ALL_EXISTING_FLAG);
    const slugs = args.filter((value) => value !== ALL_EXISTING_FLAG).map(normalizeSlug).filter(Boolean);
    if (!runAllExistingCampaign && !slugs.length) {
        throw new Error('Use --all-existing for the campaign, or provide one or more slugs');
    }
    if (runAllExistingCampaign && slugs.length) {
        throw new Error('--all-existing cannot be combined with individual slugs');
    }
    await connectDb(process.env.MONGODB_URI || process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGODB_URI (or legacy MONGO_URI) is required');
    }
    const userStore = wrapModel(getUserModel());
    if (runAllExistingCampaign) {
        const campaign = await requireAllExistingPrimaryOAuthMigrations(userStore);
        console.log('[Primary OAuth Migration Campaign]', campaign);
    } else {
        for (const slug of slugs) {
            const result = await requirePrimaryOAuthMigration(userStore, slug);
            console.log('[Primary OAuth Migration]', result);
        }
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

module.exports = {
    CAMPAIGN_EXCLUDED_SLUGS,
    requirePrimaryOAuthMigration,
    requireAllExistingPrimaryOAuthMigrations
};
