const crypto = require('crypto');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getOAuthStateModel = require('../models/oauth_state');
const {
    getAppBaseUrl,
    getStravaRedirectUri,
    getPrimaryStravaCredentials,
    getOAuthStateSecret
} = require('../config/strava');
const { normalizeSlug } = require('./connection');

const STRAVA_AUTHORIZATION_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FRONTEND_ORIGIN = 'https://fluffy-druid-f9a1d0.netlify.app';

class OAuthFlowError extends Error {
    constructor(message, statusCode, code) {
        super(message);
        this.name = 'OAuthFlowError';
        this.statusCode = statusCode || 400;
        this.code = code || 'oauth_error';
    }
}

function getOAuthStateStore() {
    return isMongoConnected() ? wrapModel(getOAuthStateModel()) : memoryStore.oauthStates;
}

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signPayload(encodedPayload) {
    return crypto.createHmac('sha256', getOAuthStateSecret()).update(encodedPayload).digest('base64url');
}

function hashState(state) {
    return crypto.createHash('sha256').update(String(state)).digest('hex');
}

function createSignedStatePayload(payload) {
    const encodedPayload = encodeJson(payload);
    return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function parseSignedState(signedState) {
    const parts = String(signedState || '').split('.');
    if (parts.length !== 2) {
        throw new OAuthFlowError('Invalid OAuth state', 400, 'invalid_state');
    }
    const expectedSignature = Buffer.from(signPayload(parts[0]));
    const receivedSignature = Buffer.from(parts[1]);
    if (expectedSignature.length !== receivedSignature.length
        || !crypto.timingSafeEqual(expectedSignature, receivedSignature)) {
        throw new OAuthFlowError('Invalid OAuth state signature', 400, 'invalid_state');
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch (error) {
        throw new OAuthFlowError('Invalid OAuth state payload', 400, 'invalid_state');
    }
    if (!normalizeSlug(payload.slug) || !payload.nonce || !Number.isFinite(Number(payload.exp))) {
        throw new OAuthFlowError('Incomplete OAuth state payload', 400, 'invalid_state');
    }
    if (Number(payload.exp) <= Date.now()) {
        throw new OAuthFlowError('OAuth state expired', 400, 'expired_state');
    }
    return payload;
}

function getAllowedReturnOrigins() {
    const origins = [DEFAULT_FRONTEND_ORIGIN, getAppBaseUrl()]
        .concat(String(process.env.FRONTEND_BASE_URL || '').split(','))
        .concat(String(process.env.ALLOWED_FRONTEND_ORIGINS || '').split(','))
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => {
            try {
                return new URL(value).origin;
            } catch (error) {
                return '';
            }
        })
        .filter(Boolean);
    return new Set(origins);
}

function normalizeReturnUrl(returnUrl, slug, connected) {
    const fallback = `/strava_user.html?user=${encodeURIComponent(slug)}${connected ? '&connected=1' : ''}`;
    if (!returnUrl) {
        return fallback;
    }
    let parsed;
    try {
        parsed = new URL(returnUrl);
    } catch (error) {
        return fallback;
    }
    const isAllowedLocalhost = process.env.NODE_ENV !== 'production'
        && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if ((!isAllowedLocalhost && !getAllowedReturnOrigins().has(parsed.origin))
        || !/\/strava_user\.html$/i.test(parsed.pathname)) {
        return fallback;
    }
    parsed.search = '';
    parsed.searchParams.set('user', slug);
    if (connected) {
        parsed.searchParams.set('connected', '1');
    }
    return parsed.toString();
}

async function createOAuthState(slugValue, returnUrl) {
    const slug = normalizeSlug(slugValue);
    if (!slug) {
        throw new OAuthFlowError('Invalid user slug', 400, 'invalid_slug');
    }
    const nonce = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    const signedState = createSignedStatePayload({ slug, nonce, exp: expiresAt.getTime() });
    await getOAuthStateStore().insertOne({
        state_hash: hashState(signedState),
        slug,
        nonce,
        expires_at: expiresAt,
        return_url: normalizeReturnUrl(returnUrl, slug, false),
        claimed_at: null,
        consumed_at: null
    });
    return signedState;
}

async function claimOAuthState(signedState) {
    const payload = parseSignedState(signedState);
    const stateStore = getOAuthStateStore();
    const stateHash = hashState(signedState);
    const record = await stateStore.findOne({ state_hash: stateHash });
    if (!record
        || record.slug !== payload.slug
        || record.nonce !== payload.nonce
        || record.claimed_at
        || record.consumed_at
        || new Date(record.expires_at).getTime() <= Date.now()) {
        throw new OAuthFlowError('OAuth state is expired or has already been used', 400, 'used_state');
    }
    const claimed = await stateStore.updateOne({
        state_hash: stateHash,
        claimed_at: null,
        consumed_at: null
    }, { claimed_at: new Date() });
    if (!claimed) {
        throw new OAuthFlowError('OAuth state has already been claimed', 400, 'used_state');
    }
    return claimed;
}

async function consumeOAuthState(record) {
    return getOAuthStateStore().updateOne({
        state_hash: record.state_hash,
        consumed_at: null
    }, { consumed_at: new Date() });
}

function buildAuthorizationUrl(signedState) {
    const credentials = getPrimaryStravaCredentials();
    const url = new URL(STRAVA_AUTHORIZATION_URL);
    url.search = new URLSearchParams({
        client_id: String(credentials.clientId),
        redirect_uri: getStravaRedirectUri(),
        response_type: 'code',
        approval_prompt: 'auto',
        scope: 'read,activity:read_all',
        state: signedState
    }).toString();
    return url.toString();
}

async function exchangeAuthorizationCode(code) {
    const credentials = getPrimaryStravaCredentials();
    const response = await fetch(STRAVA_TOKEN_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: String(credentials.clientId),
            client_secret: credentials.clientSecret,
            code: String(code || ''),
            grant_type: 'authorization_code'
        })
    });
    if (!response.ok) {
        throw new OAuthFlowError(`Strava token exchange failed with ${response.status}`, 502, 'token_exchange_failed');
    }
    const tokenData = await response.json();
    if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.athlete || !tokenData.athlete.id) {
        throw new OAuthFlowError('Strava token response was incomplete', 502, 'token_exchange_failed');
    }
    return tokenData;
}

function parseGrantedScopes(tokenData) {
    const scopeValue = tokenData.scope || tokenData.scopes || 'read,activity:read_all';
    const values = Array.isArray(scopeValue) ? scopeValue : String(scopeValue).split(',');
    return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

async function bindOAuthTokensToSlug(userStore, slugValue, tokenData) {
    const slug = normalizeSlug(slugValue);
    const athleteId = Number(tokenData.athlete.id);
    const user = await userStore.findOne({ slug });
    if (!user) {
        throw new OAuthFlowError('User slug does not exist', 404, 'unknown_slug');
    }
    if (user.strava_id != null && Number(user.strava_id) !== athleteId) {
        throw new OAuthFlowError('This slug is already bound to a different Strava athlete; admin override required', 409, 'slug_athlete_mismatch');
    }
    const athleteOwner = await userStore.findOne({ strava_id: athleteId });
    if (athleteOwner && athleteOwner.slug !== slug) {
        throw new OAuthFlowError('This Strava athlete is already bound to another slug; admin override required', 409, 'athlete_slug_mismatch');
    }
    const now = new Date();
    return userStore.updateOne({ slug }, {
        strava_id: athleteId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires: tokenData.expires_at ? new Date(Number(tokenData.expires_at) * 1000) : null,
        granted_scopes: parseGrantedScopes(tokenData),
        connection_status: 'connected',
        connected_at: user.connected_at || now,
        needs_reconnect: false,
        oauth_application: 'primary',
        migration_status: 'complete',
        sync_status: 'idle',
        sync_error: ''
    });
}

module.exports = {
    OAuthFlowError,
    createOAuthState,
    claimOAuthState,
    consumeOAuthState,
    buildAuthorizationUrl,
    exchangeAuthorizationCode,
    bindOAuthTokensToSlug,
    normalizeReturnUrl,
    parseSignedState,
    getOAuthStateStore
};
