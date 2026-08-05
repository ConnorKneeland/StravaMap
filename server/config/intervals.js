const DEFAULT_API_BASE = 'https://intervals.icu/api/v1';

function clean(value) {
    return String(value || '').trim();
}

function getIntervalsConfig() {
    return {
        apiBase: clean(process.env.INTERVALS_API_BASE) || DEFAULT_API_BASE,
        clientId: clean(process.env.INTERVALS_CLIENT_ID),
        clientSecret: clean(process.env.INTERVALS_CLIENT_SECRET),
        redirectUri: clean(process.env.INTERVALS_REDIRECT_URI),
        expectedConnorAthleteId: clean(process.env.INTERVALS_CONNOR_ATHLETE_ID),
        webhookSecret: clean(process.env.INTERVALS_WEBHOOK_SECRET),
        encryptionKey: clean(process.env.PROVIDER_TOKEN_ENCRYPTION_KEY),
        ownerSessionSecret: clean(process.env.OWNER_SESSION_SECRET),
        syncOldest: clean(process.env.INTERVALS_SYNC_OLDEST) || '1970-01-01',
        enabledSlugs: new Set((clean(process.env.INTERVALS_ENABLED_SLUGS) || 'connor')
            .split(',').map((slug) => slug.trim().toLowerCase()).filter(Boolean))
    };
}

function isIntervalsSlugEnabled(slug) {
    const normalized = clean(slug).toLowerCase();
    const enabledSlugs = getIntervalsConfig().enabledSlugs;
    return Boolean(normalized) && (enabledSlugs.has('*') || enabledSlugs.has(normalized));
}

function getIntervalsConfigurationStatus() {
    const config = getIntervalsConfig();
    const required = {
        PROVIDER_TOKEN_ENCRYPTION_KEY: config.encryptionKey.length >= 32,
        OWNER_SESSION_SECRET: config.ownerSessionSecret.length >= 32
    };
    const oauth = {
        INTERVALS_CLIENT_ID: Boolean(config.clientId),
        INTERVALS_CLIENT_SECRET: Boolean(config.clientSecret),
        INTERVALS_REDIRECT_URI: Boolean(config.redirectUri),
        INTERVALS_CONNOR_ATHLETE_ID: Boolean(config.expectedConnorAthleteId)
    };
    return {
        configured: Object.values(required).every(Boolean),
        required,
        authenticationMode: 'api_key',
        apiKeyProvisioningReady: Object.values(required).every(Boolean),
        oauthConfigured: Object.values(oauth).every(Boolean),
        oauth,
        webhookConfigured: Boolean(config.webhookSecret),
        enabledSlugs: Array.from(config.enabledSlugs),
        redirectUri: config.redirectUri || null
    };
}

module.exports = {
    getIntervalsConfig,
    isIntervalsSlugEnabled,
    getIntervalsConfigurationStatus
};
