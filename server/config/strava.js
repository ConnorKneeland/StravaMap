const DEFAULT_PRODUCTION_BASE_URL = 'https://stravamap-production-7f28.up.railway.app';

function trimTrailingSlash(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

function getAppBaseUrl() {
    const configured = trimTrailingSlash(process.env.APP_BASE_URL);
    if (configured) {
        return configured;
    }
    return isProduction()
        ? DEFAULT_PRODUCTION_BASE_URL
        : `http://localhost:${Number(process.env.PORT || 3000)}`;
}

function getStravaRedirectUri() {
    const redirectUri = String(process.env.STRAVA_REDIRECT_URI || `${getAppBaseUrl()}/api/strava/callback`).trim();
    if (isProduction() && /localhost|127\.0\.0\.1/i.test(redirectUri)) {
        throw new Error('STRAVA_REDIRECT_URI cannot use localhost in production');
    }
    return redirectUri;
}

function getPrimaryStravaCredentials() {
    const clientId = Number(process.env.PRIMARY_STRAVA_CLIENT_ID);
    const clientSecret = String(process.env.PRIMARY_STRAVA_CLIENT_SECRET || '').trim();
    if (!Number.isFinite(clientId) || clientId <= 0 || !clientSecret) {
        throw new Error('PRIMARY_STRAVA_CLIENT_ID and PRIMARY_STRAVA_CLIENT_SECRET are required');
    }
    return { clientId, clientSecret };
}

function getOAuthStateSecret() {
    const secret = String(process.env.OAUTH_STATE_SECRET || '').trim();
    if (secret.length < 32) {
        throw new Error('OAUTH_STATE_SECRET must be at least 32 characters');
    }
    return secret;
}

function getUserStravaCredentials(user) {
    if (user && user.oauth_application === 'primary') {
        return getPrimaryStravaCredentials();
    }
    const legacyClientId = Number(user && user.client_id);
    const legacyClientSecret = String((user && user.client_secret) || '').trim();
    if (Number.isFinite(legacyClientId) && legacyClientId > 0 && legacyClientSecret) {
        return { clientId: legacyClientId, clientSecret: legacyClientSecret };
    }
    return getPrimaryStravaCredentials();
}

function getConfigurationStatus() {
    const required = {
        APP_BASE_URL: Boolean(String(process.env.APP_BASE_URL || '').trim()) || !isProduction(),
        STRAVA_REDIRECT_URI: Boolean(String(process.env.STRAVA_REDIRECT_URI || '').trim()) || !isProduction(),
        PRIMARY_STRAVA_CLIENT_ID: Boolean(String(process.env.PRIMARY_STRAVA_CLIENT_ID || '').trim()),
        PRIMARY_STRAVA_CLIENT_SECRET: Boolean(String(process.env.PRIMARY_STRAVA_CLIENT_SECRET || '').trim()),
        MONGODB_URI: Boolean(String(process.env.MONGODB_URI || process.env.MONGO_URI || '').trim()),
        OAUTH_STATE_SECRET: String(process.env.OAUTH_STATE_SECRET || '').trim().length >= 32,
        STRAVA_WEBHOOK_VERIFY_TOKEN: Boolean(String(process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || '').trim()),
        NODE_ENV: process.env.NODE_ENV === 'production'
    };
    let redirectUriValid = true;
    try {
        getStravaRedirectUri();
    } catch (error) {
        redirectUriValid = false;
    }
    return {
        required,
        redirectUriValid,
        oauthConfigured: required.PRIMARY_STRAVA_CLIENT_ID
            && required.PRIMARY_STRAVA_CLIENT_SECRET
            && required.OAUTH_STATE_SECRET
            && redirectUriValid
            && (!isProduction() || (required.APP_BASE_URL && required.STRAVA_REDIRECT_URI && required.MONGODB_URI)),
        webhookConfigured: required.STRAVA_WEBHOOK_VERIFY_TOKEN
    };
}

module.exports = {
    DEFAULT_PRODUCTION_BASE_URL,
    getAppBaseUrl,
    getStravaRedirectUri,
    getPrimaryStravaCredentials,
    getOAuthStateSecret,
    getUserStravaCredentials,
    getConfigurationStatus
};
