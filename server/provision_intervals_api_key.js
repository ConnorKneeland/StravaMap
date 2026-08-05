const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { connectDb, isMongoConnected } = require('./db');
const { isIntervalsSlugEnabled } = require('./config/intervals');
const { normalizeSlug } = require('./services/connection');
const {
    PROVIDER,
    getConnectionStore,
    bindIntervalsApiKeyConnection,
    createOwnerToken,
    normalizeIntervalsReturnUrl
} = require('./services/intervals_auth');

dotenv.config();

const DEFAULT_FRONTEND_ORIGIN = 'https://fluffy-druid-f9a1d0.netlify.app';

function getFrontendOrigin() {
    const configured = String(process.env.FRONTEND_BASE_URL || '').split(',')[0].trim();
    try {
        return new URL(configured || DEFAULT_FRONTEND_ORIGIN).origin;
    } catch (error) {
        throw new Error('FRONTEND_BASE_URL must begin with http:// or https://');
    }
}

function buildOwnerLink(connection) {
    const ownerToken = createOwnerToken(connection.user_slug, connection.provider_athlete_id);
    const returnUrl = `${getFrontendOrigin()}/icu_map.html?user=${encodeURIComponent(connection.user_slug)}`;
    return normalizeIntervalsReturnUrl(returnUrl, connection.user_slug, true, ownerToken);
}

async function provisionFromEnvironment() {
    const slug = normalizeSlug(process.env.INTERVALS_SETUP_SLUG);
    const athleteId = String(process.env.INTERVALS_SETUP_ATHLETE_ID || '').trim();
    const apiKey = String(process.env.INTERVALS_SETUP_API_KEY || '').trim();
    if (!slug || !athleteId || !apiKey) {
        throw new Error(
            'INTERVALS_SETUP_SLUG, INTERVALS_SETUP_ATHLETE_ID, and INTERVALS_SETUP_API_KEY are required'
        );
    }
    if (!isIntervalsSlugEnabled(slug)) {
        throw new Error(`Add ${slug} to INTERVALS_ENABLED_SLUGS before provisioning it`);
    }
    const connection = await bindIntervalsApiKeyConnection(slug, athleteId, apiKey);
    return {
        slug: connection.user_slug,
        athleteId: connection.provider_athlete_id,
        athleteName: connection.provider_athlete_name || null,
        authentication: connection.auth_type,
        ownerLink: buildOwnerLink(connection)
    };
}

async function createOwnerLinkForSlug(slugValue) {
    const slug = normalizeSlug(slugValue);
    if (!slug || !isIntervalsSlugEnabled(slug)) {
        throw new Error('Provide an enabled Intervals.icu slug');
    }
    const connection = await getConnectionStore().findOne({ connection_key: `${PROVIDER}:${slug}` });
    if (!connection || connection.connection_status !== 'connected' || connection.needs_reconnect) {
        throw new Error(`Intervals.icu is not connected for ${slug}`);
    }
    return {
        slug,
        athleteId: connection.provider_athlete_id,
        athleteName: connection.provider_athlete_name || null,
        authentication: connection.auth_type || 'oauth',
        ownerLink: buildOwnerLink(connection)
    };
}

async function run() {
    await connectDb(process.env.MONGODB_URI || process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGODB_URI (or legacy MONGO_URI) is required for Intervals.icu provisioning');
    }
    const ownerLinkMode = process.argv.includes('--owner-link');
    const result = ownerLinkMode
        ? await createOwnerLinkForSlug(process.argv.filter((value) => value !== '--owner-link').slice(2)[0])
        : await provisionFromEnvironment();
    console.log(ownerLinkMode ? '[Intervals.icu Owner Link]' : '[Intervals.icu API Key Provisioned]', result);
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
    getFrontendOrigin,
    buildOwnerLink,
    provisionFromEnvironment,
    createOwnerLinkForSlug
};
