const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
process.env.MONGODB_URI = '';
process.env.PORT = '3000';
process.env.APP_BASE_URL = 'http://localhost:3000';
process.env.STRAVA_REDIRECT_URI = 'http://localhost:3000/api/strava/callback';
process.env.PRIMARY_STRAVA_CLIENT_ID = '999001';
process.env.PRIMARY_STRAVA_CLIENT_SECRET = 'primary-test-secret';
process.env.OAUTH_STATE_SECRET = 'test-state-secret-with-at-least-thirty-two-characters';
process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token';

const { memoryState, memoryStore } = require('../db');
const {
    buildConnectionStatus,
    isUserConnected
} = require('../services/connection');
const {
    createOAuthState,
    claimOAuthState,
    consumeOAuthState,
    bindOAuthTokensToSlug
} = require('../services/oauth');
const { refreshUserAccessToken, syncUserActivities } = require('../services/sync');
const { queueWebhookEvent, processWebhookEvent } = require('../services/webhook');
const {
    requirePrimaryOAuthMigration,
    requireAllExistingPrimaryOAuthMigrations
} = require('../require_primary_oauth');
const { createApp } = require('../index');

function resetMemory() {
    Object.keys(memoryState).forEach((key) => {
        memoryState[key].splice(0, memoryState[key].length);
    });
}

function request(server, path) {
    return new Promise((resolve, reject) => {
        const address = server.address();
        const requestHandle = http.get({
            hostname: '127.0.0.1',
            port: address.port,
            path
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        requestHandle.on('error', reject);
    });
}

test.beforeEach(() => {
    resetMemory();
});

test('a tokenized Tim is connected without an OAuth prompt', () => {
    const status = buildConnectionStatus({
        slug: 'tim',
        refresh_token: 'existing-refresh-token',
        connection_status: 'connected',
        needs_reconnect: false,
        last_sync: new Date('2025-01-01T00:00:00.000Z')
    });
    assert.equal(status.connected, true);
    assert.equal(status.needsReconnect, false);
    assert.equal(status.lastSync, '2025-01-01T00:00:00.000Z');
});

test('OAuth state is signed, stored, expiring, and one-time use', async () => {
    const signedState = await createOAuthState('tim', 'https://fluffy-druid-f9a1d0.netlify.app/strava_user.html?user=tim');
    assert.equal(signedState.split('.').length, 2);
    assert.equal(memoryState.oauthStates.length, 1);
    const claimed = await claimOAuthState(signedState);
    assert.equal(claimed.slug, 'tim');
    await consumeOAuthState(claimed);
    await assert.rejects(() => claimOAuthState(signedState), /already been used/);
});

test('one athlete cannot be attached to two slugs and one slug cannot change athlete', async () => {
    await memoryStore.users.insertOne({ slug: 'tim', display_name: 'Tim' });
    await memoryStore.users.insertOne({ slug: 'quinn', display_name: 'Quinn' });
    const tokenData = {
        access_token: 'access-a',
        refresh_token: 'refresh-a',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        athlete: { id: 12345 },
        scope: 'read,activity:read_all'
    };
    const tim = await bindOAuthTokensToSlug(memoryStore.users, 'tim', tokenData);
    assert.equal(tim.strava_id, 12345);
    assert.equal(tim.oauth_application, 'primary');
    await assert.rejects(
        () => bindOAuthTokensToSlug(memoryStore.users, 'quinn', tokenData),
        /already bound to another slug/
    );
    await assert.rejects(
        () => bindOAuthTokensToSlug(memoryStore.users, 'tim', Object.assign({}, tokenData, { athlete: { id: 98765 } })),
        /already bound to a different Strava athlete/
    );
});

test('primary-app users refresh with primary credentials and persist the rotated refresh token', async () => {
    const originalFetch = global.fetch;
    let refreshPayload;
    global.fetch = async (url, options) => {
        refreshPayload = JSON.parse(options.body);
        return new Response(JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        const user = await memoryStore.users.insertOne({
            slug: 'tim',
            display_name: 'Tim',
            refresh_token: 'old-refresh',
            token_expires: new Date(0),
            oauth_application: 'primary',
            connection_status: 'connected'
        });
        const refreshed = await refreshUserAccessToken(user);
        assert.equal(refreshPayload.client_id, 999001);
        assert.equal(refreshPayload.client_secret, 'primary-test-secret');
        assert.equal(refreshed.access_token, 'new-access');
        assert.equal(refreshed.refresh_token, 'new-refresh');
    } finally {
        global.fetch = originalFetch;
    }
});

test('a rejected refresh marks only that slug as reconnect-required', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response('{}', { status: 401 });
    try {
        const tim = await memoryStore.users.insertOne({
            slug: 'tim',
            display_name: 'Tim',
            refresh_token: 'bad-refresh',
            token_expires: new Date(0),
            oauth_application: 'primary',
            connection_status: 'connected'
        });
        await memoryStore.users.insertOne({
            slug: 'quinn',
            display_name: 'Quinn',
            refresh_token: 'good-refresh',
            oauth_application: 'primary',
            connection_status: 'connected'
        });
        await assert.rejects(() => refreshUserAccessToken(tim), /failed with 401/);
        const updatedTim = await memoryStore.users.findOne({ slug: 'tim' });
        const quinn = await memoryStore.users.findOne({ slug: 'quinn' });
        assert.equal(updatedTim.needs_reconnect, true);
        assert.equal(isUserConnected(updatedTim), false);
        assert.equal(isUserConnected(quinn), true);
    } finally {
        global.fetch = originalFetch;
    }
});

test('Tim status and connect endpoints skip OAuth when Tim already has tokens', async (t) => {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const statusResponse = await request(server, '/api/user/tim/status');
    assert.equal(statusResponse.status, 200);
    assert.equal(JSON.parse(statusResponse.body).connected, true);

    const returnUrl = encodeURIComponent('https://fluffy-druid-f9a1d0.netlify.app/strava_user.html?user=tim');
    const connectResponse = await request(server, `/api/strava/connect/tim?return_url=${returnUrl}`);
    assert.equal(connectResponse.status, 303);
    assert.match(connectResponse.headers.location, /fluffy-druid-f9a1d0\.netlify\.app\/strava_user\.html\?user=tim$/);
    assert.doesNotMatch(connectResponse.headers.location, /strava\.com\/oauth/);
});

test('an unconnected slug receives a primary-app Strava authorization redirect', async (t) => {
    const app = await createApp();
    await memoryStore.users.updateOne({ slug: 'tim' }, {
        refresh_token: '',
        access_token: '',
        connection_status: 'not_connected',
        needs_reconnect: false
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const connectResponse = await request(server, '/api/strava/connect/tim');
    assert.equal(connectResponse.status, 303);
    const authorizationUrl = new URL(connectResponse.headers.location);
    assert.equal(authorizationUrl.origin, 'https://www.strava.com');
    assert.equal(authorizationUrl.pathname, '/oauth/authorize');
    assert.equal(authorizationUrl.searchParams.get('client_id'), '999001');
    assert.equal(authorizationUrl.searchParams.get('approval_prompt'), 'auto');
    assert.equal(authorizationUrl.searchParams.get('scope'), 'read,activity:read_all');
    assert.ok(authorizationUrl.searchParams.get('state'));
});

test('initial backfill resumes into isolated storage and the next run is incremental', async () => {
    const originalFetch = global.fetch;
    let syncRound = 0;
    const requestedUrls = [];
    global.fetch = async (url) => {
        requestedUrls.push(String(url));
        if (String(url).includes('/athlete/activities')) {
            const activities = syncRound === 0 ? [
                {
                    id: 7001,
                    athlete: { id: 12345 },
                    name: 'First Tim Run',
                    type: 'Run',
                    sport_type: 'Run',
                    start_date: '2026-07-01T12:00:00Z',
                    start_date_local: '2026-07-01T07:00:00',
                    distance: 5000,
                    map: { summary_polyline: 'abc' }
                },
                {
                    id: 7002,
                    athlete: { id: 12345 },
                    name: 'Second Tim Run',
                    type: 'Run',
                    sport_type: 'Run',
                    start_date: '2026-07-02T12:00:00Z',
                    start_date_local: '2026-07-02T07:00:00',
                    distance: 6000,
                    map: { summary_polyline: 'def' }
                }
            ] : [
                {
                    id: 7003,
                    athlete: { id: 12345 },
                    name: 'New Tim Run',
                    type: 'Run',
                    sport_type: 'Run',
                    start_date: '2026-07-03T12:00:00Z',
                    start_date_local: '2026-07-03T07:00:00',
                    distance: 7000,
                    map: { summary_polyline: 'ghi' }
                }
            ];
            return new Response(JSON.stringify(activities), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        throw new Error(`Unexpected request: ${url}`);
    };
    try {
        let tim = await memoryStore.users.insertOne({
            slug: 'tim',
            display_name: 'Tim',
            strava_id: 12345,
            access_token: 'valid-access',
            refresh_token: 'valid-refresh',
            token_expires: new Date(Date.now() + 3600000),
            oauth_application: 'primary',
            connection_status: 'connected',
            backfill_complete: false
        });
        const backfill = await syncUserActivities(tim);
        assert.equal(backfill.mode, 'backfill');
        assert.equal(backfill.recordsInserted, 2);
        assert.equal(backfill.backfillComplete, true);
        assert.equal(await memoryStore.activities.count({ user_slug: 'tim' }), 2);

        syncRound = 1;
        tim = await memoryStore.users.findOne({ slug: 'tim' });
        const incremental = await syncUserActivities(tim);
        assert.equal(incremental.mode, 'incremental');
        assert.equal(incremental.recordsInserted, 1);
        assert.equal(await memoryStore.activities.count({ user_slug: 'tim' }), 3);
        assert.ok(requestedUrls.some((url) => new URL(url).searchParams.has('after')));
        const stored = await memoryStore.activities.find({ user_slug: 'tim' });
        assert.ok(stored.every((activity) => activity.athlete_strava_id === 12345));
    } finally {
        global.fetch = originalFetch;
    }
});

test('a cross-athlete activity payload is blocked before it can contaminate a slug', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify([{
        id: 8001,
        athlete: { id: 99999 },
        name: 'Wrong athlete activity',
        type: 'Run',
        start_date: '2026-07-01T12:00:00Z'
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    try {
        const tim = await memoryStore.users.insertOne({
            slug: 'tim',
            display_name: 'Tim',
            strava_id: 12345,
            access_token: 'valid-access',
            refresh_token: 'valid-refresh',
            token_expires: new Date(Date.now() + 3600000),
            oauth_application: 'primary',
            connection_status: 'connected',
            backfill_complete: false
        });
        await assert.rejects(() => syncUserActivities(tim), /athlete mismatch/);
        assert.equal(await memoryStore.activities.count({ user_slug: 'tim' }), 0);
    } finally {
        global.fetch = originalFetch;
    }
});

test('webhook deletion is scoped by both athlete binding and slug', async () => {
    await memoryStore.users.insertOne({
        slug: 'tim',
        display_name: 'Tim',
        strava_id: 12345,
        refresh_token: 'tim-refresh',
        connection_status: 'connected'
    });
    await memoryStore.users.insertOne({
        slug: 'quinn',
        display_name: 'Quinn',
        strava_id: 54321,
        refresh_token: 'quinn-refresh',
        connection_status: 'connected'
    });
    await memoryStore.activities.insertOne({ strava_id: 9001, user_slug: 'tim', user_id: 'tim', name: 'Tim activity' });
    await memoryStore.activities.insertOne({ strava_id: 9002, user_slug: 'quinn', user_id: 'quinn', name: 'Quinn activity' });
    const event = await queueWebhookEvent({
        owner_id: 12345,
        object_id: 9001,
        object_type: 'activity',
        aspect_type: 'delete',
        event_time: 1785000000
    });
    await processWebhookEvent(event);
    assert.equal(await memoryStore.activities.findOne({ strava_id: 9001, user_slug: 'tim' }), null);
    assert.ok(await memoryStore.activities.findOne({ strava_id: 9002, user_slug: 'quinn' }));
});

test('public user and activity APIs do not expose tokens or unscoped activities', async (t) => {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const userResponse = await request(server, '/api/users/tim');
    const publicUser = JSON.parse(userResponse.body);
    assert.equal(userResponse.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(publicUser, 'access_token'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(publicUser, 'refresh_token'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(publicUser, 'client_secret'), false);

    const activityResponse = await request(server, '/api/activities');
    assert.equal(activityResponse.status, 400);
});

test('a valid legacy user can be required to authorize the primary app without deleting legacy credentials', async () => {
    await memoryStore.users.insertOne({
        slug: 'michael',
        display_name: 'Michael',
        strava_id: 24680,
        client_id: 162250,
        client_secret: 'legacy-secret',
        access_token: 'legacy-access',
        refresh_token: 'legacy-refresh',
        connection_status: 'connected',
        needs_reconnect: false,
        oauth_application: 'legacy',
        migration_status: 'pending'
    });
    const result = await requirePrimaryOAuthMigration(memoryStore.users, 'michael');
    const updated = await memoryStore.users.findOne({ slug: 'michael' });
    assert.equal(result.action, 'primary-oauth-required');
    assert.equal(updated.connection_status, 'reconnect_required');
    assert.equal(updated.needs_reconnect, true);
    assert.equal(updated.migration_status, 'required');
    assert.equal(updated.oauth_application, 'legacy');
    assert.equal(updated.strava_id, 24680);
    assert.equal(updated.refresh_token, 'legacy-refresh');
    assert.equal(updated.client_secret, 'legacy-secret');
});

test('requiring primary OAuth is a no-op for an already migrated user', async () => {
    await memoryStore.users.insertOne({
        slug: 'michael',
        display_name: 'Michael',
        strava_id: 24680,
        refresh_token: 'primary-refresh',
        connection_status: 'connected',
        needs_reconnect: false,
        oauth_application: 'primary',
        migration_status: 'complete'
    });
    const result = await requirePrimaryOAuthMigration(memoryStore.users, 'michael');
    const updated = await memoryStore.users.findOne({ slug: 'michael' });
    assert.equal(result.action, 'already-primary');
    assert.equal(updated.connection_status, 'connected');
    assert.equal(updated.needs_reconnect, false);
    assert.equal(updated.refresh_token, 'primary-refresh');
});

test('the all-existing campaign excludes connor and tim and targets every other legacy slug', async () => {
    for (const slug of ['connor', 'tim', 'quinn', 'michael', 'mwelsh', 'kemily', 'brett', 'lee']) {
        await memoryStore.users.insertOne({
            slug,
            display_name: slug,
            strava_id: 10000 + memoryState.users.length,
            refresh_token: `${slug}-legacy-refresh`,
            connection_status: 'connected',
            needs_reconnect: false,
            oauth_application: 'legacy',
            migration_status: 'pending'
        });
    }
    await memoryStore.users.insertOne({
        slug: 'alreadyprimary',
        display_name: 'Already Primary',
        strava_id: 20000,
        refresh_token: 'primary-refresh',
        connection_status: 'connected',
        needs_reconnect: false,
        oauth_application: 'primary',
        migration_status: 'complete'
    });

    const campaign = await requireAllExistingPrimaryOAuthMigrations(memoryStore.users);
    assert.deepEqual(campaign.excludedSlugs, ['connor', 'tim']);
    assert.equal(campaign.totalExistingUsers, 9);
    assert.equal(campaign.primaryOAuthRequired, 6);
    assert.equal(campaign.alreadyPrimary, 1);

    for (const slug of ['connor', 'tim']) {
        const user = await memoryStore.users.findOne({ slug });
        assert.equal(user.connection_status, 'connected');
        assert.equal(user.needs_reconnect, false);
    }
    for (const slug of ['quinn', 'michael', 'mwelsh', 'kemily', 'brett', 'lee']) {
        const user = await memoryStore.users.findOne({ slug });
        assert.equal(user.connection_status, 'reconnect_required');
        assert.equal(user.needs_reconnect, true);
        assert.equal(user.refresh_token, `${slug}-legacy-refresh`);
        assert.equal(user.oauth_application, 'legacy');
    }
    const alreadyPrimary = await memoryStore.users.findOne({ slug: 'alreadyprimary' });
    assert.equal(alreadyPrimary.connection_status, 'connected');
    assert.equal(alreadyPrimary.needs_reconnect, false);
});
