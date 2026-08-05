const crypto = require('crypto');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getOAuthStateModel = require('../models/oauth_state');
const getProviderConnectionModel = require('../models/provider_connection');
const { getOAuthStateSecret, getAppBaseUrl } = require('../config/strava');
const { getIntervalsConfig, isIntervalsSlugEnabled } = require('../config/intervals');
const { normalizeSlug } = require('./connection');

const PROVIDER = 'intervals_icu';
const AUTHORIZATION_URL = 'https://intervals.icu/oauth/authorize';
const TOKEN_URL = 'https://intervals.icu/api/oauth/token';
const STATE_TTL_MS = 10 * 60 * 1000;
const OWNER_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_FRONTEND_ORIGIN = 'https://fluffy-druid-f9a1d0.netlify.app';

class IntervalsAuthError extends Error {
    constructor(message, statusCode, code) {
        super(message);
        this.name = 'IntervalsAuthError';
        this.statusCode = statusCode || 400;
        this.code = code || 'intervals_auth_error';
    }
}

function getConnectionStore() {
    return isMongoConnected() ? wrapModel(getProviderConnectionModel()) : memoryStore.providerConnections;
}

function getStateStore() {
    return isMongoConnected() ? wrapModel(getOAuthStateModel()) : memoryStore.oauthStates;
}

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(encoded, secret) {
    return crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
}

function createSignedPayload(payload, secret) {
    const encoded = encodeJson(payload);
    return `${encoded}.${sign(encoded, secret)}`;
}

function parseSignedPayload(value, secret, errorCode) {
    const parts = String(value || '').split('.');
    if (parts.length !== 2) {
        throw new IntervalsAuthError('Invalid signed token', 401, errorCode);
    }
    const expected = Buffer.from(sign(parts[0], secret));
    const received = Buffer.from(parts[1]);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        throw new IntervalsAuthError('Invalid signed token', 401, errorCode);
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch (error) {
        throw new IntervalsAuthError('Invalid signed token payload', 401, errorCode);
    }
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= Date.now()) {
        throw new IntervalsAuthError('Signed token expired', 401, errorCode);
    }
    return payload;
}

function stateHash(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function getAllowedOrigins() {
    const values = [DEFAULT_FRONTEND_ORIGIN, getAppBaseUrl()]
        .concat(String(process.env.FRONTEND_BASE_URL || '').split(','))
        .concat(String(process.env.ALLOWED_FRONTEND_ORIGINS || '').split(','));
    return new Set(values.map((value) => {
        try {
            return new URL(String(value || '').trim()).origin;
        } catch (error) {
            return '';
        }
    }).filter(Boolean));
}

function normalizeIntervalsReturnUrl(returnUrl, slug, connected, ownerToken) {
    const suffix = connected ? '&connected=1' : '';
    const fallback = `/icu_map.html?user=${encodeURIComponent(slug)}${suffix}`;
    let normalized = fallback;
    if (returnUrl) {
        try {
            const parsed = new URL(returnUrl);
            const local = process.env.NODE_ENV !== 'production'
                && ['localhost', '127.0.0.1'].includes(parsed.hostname);
            if ((local || getAllowedOrigins().has(parsed.origin)) && /\/icu_map(?:\.html)?$/i.test(parsed.pathname)) {
                parsed.search = '';
                parsed.searchParams.set('user', slug);
                if (connected) {
                    parsed.searchParams.set('connected', '1');
                }
                normalized = parsed.toString();
            }
        } catch (error) {
            normalized = fallback;
        }
    }
    return ownerToken ? `${normalized}#owner_token=${encodeURIComponent(ownerToken)}` : normalized;
}

async function createIntervalsOAuthState(slugValue, returnUrl) {
    const slug = normalizeSlug(slugValue);
    if (slug !== 'connor' || !isIntervalsSlugEnabled(slug)) {
        throw new IntervalsAuthError('Intervals.icu is not enabled for this user', 404, 'provider_not_enabled');
    }
    const nonce = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    const payload = { slug, provider: PROVIDER, nonce, exp: expiresAt.getTime() };
    const state = createSignedPayload(payload, getOAuthStateSecret());
    await getStateStore().insertOne({
        state_hash: stateHash(state),
        slug,
        provider: PROVIDER,
        nonce,
        expires_at: expiresAt,
        return_url: normalizeIntervalsReturnUrl(returnUrl, slug, false),
        claimed_at: null,
        consumed_at: null
    });
    return state;
}

async function claimIntervalsOAuthState(state) {
    const payload = parseSignedPayload(state, getOAuthStateSecret(), 'invalid_state');
    if (payload.provider !== PROVIDER || !normalizeSlug(payload.slug) || !payload.nonce) {
        throw new IntervalsAuthError('Invalid Intervals.icu OAuth state', 400, 'invalid_state');
    }
    const store = getStateStore();
    const filter = { state_hash: stateHash(state), provider: PROVIDER };
    const record = await store.findOne(filter);
    if (!record || record.slug !== payload.slug || record.nonce !== payload.nonce
        || record.claimed_at || record.consumed_at
        || new Date(record.expires_at).getTime() <= Date.now()) {
        throw new IntervalsAuthError('OAuth state is expired or has already been used', 400, 'used_state');
    }
    const claimed = await store.updateOne(Object.assign({}, filter, { claimed_at: null, consumed_at: null }), {
        claimed_at: new Date()
    });
    if (!claimed) {
        throw new IntervalsAuthError('OAuth state has already been claimed', 400, 'used_state');
    }
    return claimed;
}

async function consumeIntervalsOAuthState(record) {
    return getStateStore().updateOne({ state_hash: record.state_hash, consumed_at: null }, {
        consumed_at: new Date()
    });
}

function buildIntervalsAuthorizationUrl(state) {
    const config = getIntervalsConfig();
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
        throw new IntervalsAuthError('Intervals.icu OAuth is not configured', 503, 'oauth_not_configured');
    }
    const url = new URL(AUTHORIZATION_URL);
    url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'ACTIVITY:READ',
        state
    }).toString();
    return url.toString();
}

async function exchangeIntervalsCode(code) {
    const config = getIntervalsConfig();
    if (!config.clientId || !config.clientSecret) {
        throw new IntervalsAuthError('Intervals.icu OAuth is not configured', 503, 'oauth_not_configured');
    }
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code: String(code || '')
        })
    });
    if (!response.ok) {
        throw new IntervalsAuthError(`Intervals.icu token exchange failed with ${response.status}`, 502, 'token_exchange_failed');
    }
    const token = await response.json();
    if (!token.access_token || !token.athlete || !token.athlete.id) {
        throw new IntervalsAuthError('Intervals.icu token response was incomplete', 502, 'token_exchange_failed');
    }
    return token;
}

function deriveEncryptionKey(secret) {
    if (!secret) {
        throw new IntervalsAuthError('Provider token encryption is not configured', 503, 'encryption_not_configured');
    }
    return crypto.createHash('sha256').update(secret).digest();
}

function encryptAccessToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveEncryptionKey(getIntervalsConfig().encryptionKey), iv);
    const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
    return {
        encrypted_access_token: encrypted.toString('base64'),
        token_iv: iv.toString('base64'),
        token_auth_tag: cipher.getAuthTag().toString('base64')
    };
}

function decryptAccessToken(connection) {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        deriveEncryptionKey(getIntervalsConfig().encryptionKey),
        Buffer.from(connection.token_iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(connection.token_auth_tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(connection.encrypted_access_token, 'base64')),
        decipher.final()
    ]).toString('utf8');
}

function buildIntervalsBasicAuthorization(apiKey) {
    return `Basic ${Buffer.from(`API_KEY:${String(apiKey || '')}`, 'utf8').toString('base64')}`;
}

function buildIntervalsProviderAuthorization(connection) {
    const credential = decryptAccessToken(connection);
    return connection && connection.auth_type === 'api_key'
        ? buildIntervalsBasicAuthorization(credential)
        : `Bearer ${credential}`;
}

function normalizeIntervalsAthleteProfile(payload) {
    const athlete = payload && typeof payload === 'object' && payload.athlete
        ? payload.athlete
        : payload;
    if (!athlete || typeof athlete !== 'object') {
        return null;
    }
    const id = athlete.id !== undefined && athlete.id !== null
        ? athlete.id
        : (athlete.icu_athlete_id !== undefined && athlete.icu_athlete_id !== null
            ? athlete.icu_athlete_id
            : athlete.athlete_id);
    if (id === undefined || id === null || String(id).trim() === '') {
        return null;
    }
    const combinedName = [athlete.first_name || athlete.firstname, athlete.last_name || athlete.lastname]
        .map((value) => String(value || '').trim()).filter(Boolean).join(' ');
    return {
        id: String(id).trim(),
        name: String(athlete.name || athlete.display_name || combinedName || '').trim()
    };
}

async function verifyIntervalsApiKey(apiKeyValue, expectedAthleteIdValue) {
    const apiKey = String(apiKeyValue || '').trim();
    const expectedAthleteId = String(expectedAthleteIdValue || '').trim();
    if (!apiKey || !expectedAthleteId) {
        throw new IntervalsAuthError('An Intervals.icu athlete ID and API key are required', 400, 'api_key_required');
    }
    const url = `${getIntervalsConfig().apiBase.replace(/\/$/, '')}/athlete/0`;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Authorization: buildIntervalsBasicAuthorization(apiKey)
        }
    });
    if (!response.ok) {
        const invalid = response.status === 401 || response.status === 403;
        throw new IntervalsAuthError(
            invalid
                ? 'Intervals.icu rejected the personal API key'
                : `Intervals.icu athlete verification failed with ${response.status}`,
            invalid ? 401 : 502,
            invalid ? 'invalid_api_key' : 'athlete_verification_failed'
        );
    }
    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        throw new IntervalsAuthError('Intervals.icu returned an invalid athlete profile', 502, 'athlete_verification_failed');
    }
    const profile = normalizeIntervalsAthleteProfile(payload);
    if (!profile) {
        throw new IntervalsAuthError('Intervals.icu did not return a usable athlete ID', 502, 'athlete_verification_failed');
    }
    if (profile.id !== expectedAthleteId) {
        throw new IntervalsAuthError(
            `The API key belongs to athlete ${profile.id}, not ${expectedAthleteId}`,
            409,
            'athlete_mismatch'
        );
    }
    return profile;
}

function parseScopes(tokenData) {
    return Array.from(new Set(String(tokenData.scope || '').split(',').map((value) => value.trim()).filter(Boolean)));
}

async function bindIntervalsConnection(slugValue, tokenData) {
    const slug = normalizeSlug(slugValue);
    const athleteId = String(tokenData.athlete.id);
    const config = getIntervalsConfig();
    if (slug !== 'connor' || athleteId !== String(config.expectedConnorAthleteId)) {
        throw new IntervalsAuthError('This Intervals.icu athlete does not match Connor', 409, 'athlete_mismatch');
    }
    const existingOwner = await getConnectionStore().findOne({ provider: PROVIDER, provider_athlete_id: athleteId });
    if (existingOwner && existingOwner.user_slug !== slug) {
        throw new IntervalsAuthError('This Intervals.icu athlete is already connected', 409, 'athlete_already_connected');
    }
    const encrypted = encryptAccessToken(tokenData.access_token);
    return getConnectionStore().upsertOne({ connection_key: `${PROVIDER}:${slug}` }, Object.assign({}, encrypted, {
        connection_key: `${PROVIDER}:${slug}`,
        user_slug: slug,
        provider: PROVIDER,
        provider_athlete_id: athleteId,
        provider_athlete_name: String(tokenData.athlete.name || ''),
        auth_type: 'oauth',
        granted_scopes: parseScopes(tokenData),
        connection_status: 'connected',
        needs_reconnect: false,
        connected_at: existingOwner && existingOwner.connected_at ? existingOwner.connected_at : new Date(),
        sync_status: 'idle',
        sync_retry_at: null,
        sync_error: ''
    }));
}

async function bindIntervalsApiKeyConnection(slugValue, athleteIdValue, apiKeyValue) {
    const slug = normalizeSlug(slugValue);
    if (!slug || !isIntervalsSlugEnabled(slug)) {
        throw new IntervalsAuthError(
            'This slug is not listed in INTERVALS_ENABLED_SLUGS',
            404,
            'provider_not_enabled'
        );
    }
    const profile = await verifyIntervalsApiKey(apiKeyValue, athleteIdValue);
    const store = getConnectionStore();
    const connectionKey = `${PROVIDER}:${slug}`;
    const existingConnection = await store.findOne({ connection_key: connectionKey });
    if (existingConnection && String(existingConnection.provider_athlete_id) !== profile.id) {
        throw new IntervalsAuthError(
            `The slug ${slug} is already connected to a different Intervals.icu athlete`,
            409,
            'slug_already_connected'
        );
    }
    const existingOwner = await store.findOne({ provider: PROVIDER, provider_athlete_id: profile.id });
    if (existingOwner && existingOwner.user_slug !== slug) {
        throw new IntervalsAuthError(
            'This Intervals.icu athlete is already connected to another slug',
            409,
            'athlete_already_connected'
        );
    }
    const encrypted = encryptAccessToken(String(apiKeyValue || '').trim());
    return store.upsertOne({ connection_key: connectionKey }, Object.assign({}, encrypted, {
        connection_key: connectionKey,
        user_slug: slug,
        provider: PROVIDER,
        provider_athlete_id: profile.id,
        provider_athlete_name: profile.name,
        auth_type: 'api_key',
        granted_scopes: ['PERSONAL_API_KEY'],
        connection_status: 'connected',
        needs_reconnect: false,
        connected_at: existingConnection && existingConnection.connected_at
            ? existingConnection.connected_at
            : new Date(),
        sync_status: 'idle',
        sync_retry_at: null,
        sync_error: ''
    }));
}

function createOwnerToken(slug, athleteId) {
    const config = getIntervalsConfig();
    if (config.ownerSessionSecret.length < 32) {
        throw new IntervalsAuthError('Owner sessions are not configured', 503, 'owner_session_not_configured');
    }
    return createSignedPayload({
        slug: normalizeSlug(slug),
        provider: PROVIDER,
        athlete_id: String(athleteId),
        exp: Date.now() + OWNER_TOKEN_TTL_MS
    }, config.ownerSessionSecret);
}

function verifyOwnerToken(token, expectedSlug) {
    const config = getIntervalsConfig();
    if (config.ownerSessionSecret.length < 32) {
        throw new IntervalsAuthError('Owner sessions are not configured', 503, 'owner_session_not_configured');
    }
    const payload = parseSignedPayload(token, config.ownerSessionSecret, 'invalid_owner_token');
    if (payload.provider !== PROVIDER || normalizeSlug(payload.slug) !== normalizeSlug(expectedSlug)
        || !String(payload.athlete_id || '').trim()) {
        throw new IntervalsAuthError('Owner token does not match this map', 403, 'owner_token_mismatch');
    }
    return payload;
}

function readBearerToken(req) {
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
}

function requireIntervalsOwner(req, res, next) {
    try {
        const slug = normalizeSlug(req.params.slug || req.query.user || (req.body && req.body.user_slug));
        req.intervalsOwner = verifyOwnerToken(readBearerToken(req), slug);
        next();
    } catch (error) {
        res.status(error.statusCode || 401).json({ error: error.message, code: error.code || 'owner_auth_required' });
    }
}

function buildIntervalsConnectionStatus(connection, slugValue) {
    const slug = normalizeSlug(slugValue || (connection && connection.user_slug));
    const config = getIntervalsConfig();
    const oauthAvailable = slug === 'connor'
        && Boolean(config.clientId && config.clientSecret && config.redirectUri && config.expectedConnorAthleteId);
    return {
        provider: PROVIDER,
        connected: Boolean(connection && connection.connection_status === 'connected' && !connection.needs_reconnect),
        needsReconnect: Boolean(connection && connection.needs_reconnect),
        connectionMethod: connection ? (connection.auth_type || 'oauth') : null,
        athleteName: connection && connection.provider_athlete_name || null,
        interactiveConnectAvailable: oauthAvailable,
        lastSync: connection && connection.last_sync || null,
        syncStatus: connection && connection.sync_status || 'idle',
        progress: connection && connection.sync_progress || null,
        totalActivities: Number(connection && connection.total_activities || 0),
        backfillComplete: Boolean(connection && connection.backfill_complete),
        lastImport: connection && connection.last_import_at || null,
        lastImportSummary: connection && connection.last_import_summary || null
    };
}

module.exports = {
    PROVIDER,
    IntervalsAuthError,
    getConnectionStore,
    createIntervalsOAuthState,
    claimIntervalsOAuthState,
    consumeIntervalsOAuthState,
    buildIntervalsAuthorizationUrl,
    exchangeIntervalsCode,
    bindIntervalsConnection,
    normalizeIntervalsReturnUrl,
    encryptAccessToken,
    decryptAccessToken,
    buildIntervalsBasicAuthorization,
    buildIntervalsProviderAuthorization,
    normalizeIntervalsAthleteProfile,
    verifyIntervalsApiKey,
    bindIntervalsApiKeyConnection,
    createOwnerToken,
    verifyOwnerToken,
    requireIntervalsOwner,
    buildIntervalsConnectionStatus
};
