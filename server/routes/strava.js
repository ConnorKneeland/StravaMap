const express = require('express');
const { getConfigurationStatus } = require('../config/strava');
const {
    ensureKnownUser,
    buildConnectionStatus,
    isUserConnected,
    normalizeSlug
} = require('../services/connection');
const {
    OAuthFlowError,
    createOAuthState,
    claimOAuthState,
    consumeOAuthState,
    buildAuthorizationUrl,
    exchangeAuthorizationCode,
    bindOAuthTokensToSlug,
    normalizeReturnUrl
} = require('../services/oauth');
const { getUserStore, syncUserActivities } = require('../services/sync');
const { queueWebhookEvent, processWebhookEvent } = require('../services/webhook');

const router = express.Router();

function sendOAuthError(res, error) {
    const statusCode = error instanceof OAuthFlowError ? error.statusCode : 500;
    res.status(statusCode).json({
        error: error && error.message ? error.message : 'Strava OAuth failed',
        code: error && error.code ? error.code : 'oauth_error'
    });
}

router.get('/user/:slug/status', async (req, res) => {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) {
        res.status(400).json({ error: 'Invalid user slug' });
        return;
    }
    const user = await ensureKnownUser(getUserStore(), slug);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(buildConnectionStatus(user));
});

router.get('/strava/connect/:slug', async (req, res) => {
    try {
        const slug = normalizeSlug(req.params.slug);
        if (!slug) {
            throw new OAuthFlowError('Invalid user slug', 400, 'invalid_slug');
        }
        const user = await ensureKnownUser(getUserStore(), slug);
        if (!user) {
            throw new OAuthFlowError('User slug does not exist', 404, 'unknown_slug');
        }
        if (isUserConnected(user)) {
            res.redirect(303, normalizeReturnUrl(req.query.return_url, slug, false));
            return;
        }
        const configuration = getConfigurationStatus();
        if (!configuration.oauthConfigured) {
            throw new OAuthFlowError('Shared Strava OAuth is not configured on the server', 503, 'oauth_not_configured');
        }
        const state = await createOAuthState(slug, req.query.return_url);
        res.redirect(303, buildAuthorizationUrl(state));
    } catch (error) {
        sendOAuthError(res, error);
    }
});

router.get('/strava/callback', async (req, res) => {
    let stateRecord;
    try {
        if (req.query.error) {
            throw new OAuthFlowError('Strava authorization was declined', 400, 'authorization_declined');
        }
        if (!req.query.code || !req.query.state) {
            throw new OAuthFlowError('Missing OAuth code or state', 400, 'invalid_callback');
        }
        stateRecord = await claimOAuthState(req.query.state);
        const tokenData = await exchangeAuthorizationCode(req.query.code);
        const user = await bindOAuthTokensToSlug(getUserStore(), stateRecord.slug, tokenData);
        await consumeOAuthState(stateRecord);
        res.redirect(303, normalizeReturnUrl(stateRecord.return_url, stateRecord.slug, true));

        setImmediate(() => {
            syncUserActivities(user).catch((error) => {
                console.warn('[Post OAuth Strava Sync Failed]', {
                    user: stateRecord.slug,
                    error: error && error.message ? error.message : 'Unknown sync error'
                });
            });
        });
    } catch (error) {
        sendOAuthError(res, error);
    }
});

router.get('/strava/webhook', (req, res) => {
    const verifyToken = String(process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || '');
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = req.query['hub.challenge'];
    if (mode !== 'subscribe' || !verifyToken || token !== verifyToken || !challenge) {
        res.status(403).json({ error: 'Webhook verification failed' });
        return;
    }
    res.json({ 'hub.challenge': challenge });
});

router.post('/strava/webhook', async (req, res) => {
    const payload = req.body || {};
    if (!Number(payload.owner_id) || !payload.object_type || !payload.aspect_type) {
        res.status(400).json({ error: 'Invalid Strava webhook event' });
        return;
    }
    const event = await queueWebhookEvent(payload);
    res.status(202).json({ accepted: true });
    setImmediate(() => {
        processWebhookEvent(event).catch((error) => {
            console.warn('[Strava Webhook Processing Failed]', error && error.message ? error.message : error);
        });
    });
});

module.exports = router;
