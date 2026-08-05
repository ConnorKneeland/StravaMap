const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
process.env.MONGODB_URI = '';
process.env.APP_BASE_URL = 'http://localhost:3000';
process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-with-at-least-thirty-two-characters';
process.env.INTERVALS_CLIENT_ID = 'icu-client-id';
process.env.INTERVALS_CLIENT_SECRET = 'icu-client-secret';
process.env.INTERVALS_REDIRECT_URI = 'http://localhost:3000/api/intervals/callback';
process.env.INTERVALS_CONNOR_ATHLETE_ID = 'a1001';
process.env.INTERVALS_ENABLED_SLUGS = 'connor,matthew';
process.env.INTERVALS_WEBHOOK_SECRET = 'icu-webhook-secret';
process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = 'test-provider-encryption-secret-with-32-characters';
process.env.OWNER_SESSION_SECRET = 'test-owner-session-secret-with-at-least-thirty-two-characters';
process.env.INTERVALS_SYNC_OLDEST = '1970-01-01';

const { memoryState, memoryStore } = require('../db');
const { createApp } = require('../index');
const {
    transformIntervalsActivity,
    transformIntervalsMap,
    transformIntervalsStreams,
    intervalsFetchJson,
    syncIntervalsActivities
} = require('../services/intervals_sync');
const {
    createIntervalsOAuthState,
    claimIntervalsOAuthState,
    buildIntervalsAuthorizationUrl,
    bindIntervalsConnection,
    bindIntervalsApiKeyConnection,
    decryptAccessToken,
    buildIntervalsProviderAuthorization,
    createOwnerToken,
    verifyOwnerToken
} = require('../services/intervals_auth');

function resetMemory() {
    Object.keys(memoryState).forEach((key) => memoryState[key].splice(0, memoryState[key].length));
}

function request(server, path, options = {}) {
    return new Promise((resolve, reject) => {
        const address = server.address();
        const body = options.body == null ? '' : JSON.stringify(options.body);
        const handle = http.request({
            hostname: '127.0.0.1',
            port: address.port,
            path,
            method: options.method || 'GET',
            headers: Object.assign({}, body ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            } : {}, options.headers || {})
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        handle.on('error', reject);
        handle.end(body);
    });
}

function fixtureActivity(id, overrides) {
    return Object.assign({
        id,
        name: `Garmin Run ${id}`,
        type: 'Run',
        sub_type: 'Tempo',
        source: 'GARMIN',
        start_date: '2026-07-01T12:00:00Z',
        start_date_local: '2026-07-01T07:00:00',
        distance: 5000,
        moving_time: 1500,
        elapsed_time: 1550,
        total_elevation_gain: 80,
        average_heartrate: 151,
        icu_average_watts: 248,
        icu_weighted_avg_watts: 263,
        icu_training_load: 72,
        icu_intervals: [{ name: 'Tempo', moving_time: 600 }]
    }, overrides || {});
}

test.beforeEach(resetMemory);

test('Intervals.icu transformers preserve string ids, concordance, intervals, maps, and streams', () => {
    const transformed = transformIntervalsActivity('connor', 'a1001', fixtureActivity('i55751783'), { detail: true });
    assert.equal(transformed.activity_key, 'intervals_icu:i55751783');
    assert.equal(transformed.intervals_activity_id, 'i55751783');
    assert.equal(transformed.name, 'Garmin Run i55751783');
    assert.equal(transformed.activity_type_key, 'run');
    assert.equal(transformed.workout_category, 'tempo');
    assert.equal(transformed.average_watts, 248);
    assert.equal(transformed.weighted_average_watts, 263);
    assert.equal(transformed.intervals_metrics.icu_training_load, 72);
    assert.equal(transformed.intervals[0].name, 'Tempo');

    const map = transformIntervalsMap({ latlngs: [[44.9, -93.2], [45, -93.1]] });
    assert.deepEqual(map.start_latlng, [44.9, -93.2]);
    assert.deepEqual(map.end_latlng, [45, -93.1]);
    assert.deepEqual(map.stream_data.latlng, map.stream_latlng);

    const streams = transformIntervalsStreams([
        { type: 'speed', data: [2.5, 3.1] },
        { type: 'heart_rate', data: [140, 150] },
        { type: 'latlng', data: [44.9, 45], data2: [-93.2, -93.1] }
    ]);
    assert.deepEqual(streams.stream_data.velocity_smooth, [2.5, 3.1]);
    assert.deepEqual(streams.stream_data.heartrate, [140, 150]);
    assert.equal(streams.stream_latlng.length, 2);
});

test('Hidden, Strava-sourced, and incomplete Intervals.icu records are rejected', () => {
    assert.equal(transformIntervalsActivity('connor', 'a1001', {
        id: 'h1', icu_athlete_id: 'a1001', source: 'GARMIN', start_date_local: '2026-01-01', _note: 'Hidden'
    }), null);
    assert.equal(transformIntervalsActivity('connor', 'a1001', fixtureActivity('i2', { source: 'STRAVA' })), null);
    assert.equal(transformIntervalsActivity('connor', 'a1001', fixtureActivity('i3', { name: '' })), null);
});

test('OAuth state requests only ACTIVITY:READ and credentials are encrypted and athlete-bound', async () => {
    const state = await createIntervalsOAuthState('connor', 'https://fluffy-druid-f9a1d0.netlify.app/icu_map.html?user=connor');
    const authorization = new URL(buildIntervalsAuthorizationUrl(state));
    assert.equal(authorization.origin, 'https://intervals.icu');
    assert.equal(authorization.searchParams.get('scope'), 'ACTIVITY:READ');
    assert.equal((await claimIntervalsOAuthState(state)).slug, 'connor');

    const connection = await bindIntervalsConnection('connor', {
        access_token: 'plain-provider-token',
        scope: 'ACTIVITY:READ',
        athlete: { id: 'a1001', name: 'Connor' }
    });
    assert.notEqual(connection.encrypted_access_token, 'plain-provider-token');
    assert.equal(JSON.stringify(connection).includes('plain-provider-token'), false);
    assert.equal(decryptAccessToken(connection), 'plain-provider-token');

    await assert.rejects(() => bindIntervalsConnection('connor', {
        access_token: 'wrong-token', scope: 'ACTIVITY:READ', athlete: { id: 'someone-else' }
    }), /does not match Connor/);
});

test('personal API keys are verified, encrypted, and bound to any enabled slug using Basic authentication', async () => {
    const originalFetch = global.fetch;
    let authorization = '';
    global.fetch = async (url, options) => {
        assert.equal(String(url), 'https://intervals.icu/api/v1/athlete/0');
        authorization = options.headers.Authorization;
        return Response.json({ id: 'm2002', name: 'Matthew Example' });
    };
    try {
        const connection = await bindIntervalsApiKeyConnection('matthew', 'm2002', 'personal-api-key-secret');
        assert.equal(connection.user_slug, 'matthew');
        assert.equal(connection.provider_athlete_id, 'm2002');
        assert.equal(connection.provider_athlete_name, 'Matthew Example');
        assert.equal(connection.auth_type, 'api_key');
        assert.notEqual(connection.encrypted_access_token, 'personal-api-key-secret');
        assert.equal(JSON.stringify(connection).includes('personal-api-key-secret'), false);
        assert.equal(decryptAccessToken(connection), 'personal-api-key-secret');
        assert.equal(Buffer.from(authorization.replace(/^Basic /, ''), 'base64').toString('utf8'),
            'API_KEY:personal-api-key-secret');
        assert.equal(Buffer.from(buildIntervalsProviderAuthorization(connection).replace(/^Basic /, ''), 'base64')
            .toString('utf8'), 'API_KEY:personal-api-key-secret');
        assert.equal(verifyOwnerToken(createOwnerToken('matthew', 'm2002'), 'matthew').athlete_id, 'm2002');

        global.fetch = async () => Response.json({ id: 'different-athlete', name: 'Wrong Athlete' });
        await assert.rejects(
            () => bindIntervalsApiKeyConnection('matthew', 'm2002', 'wrong-account-key'),
            /belongs to athlete different-athlete/
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test('owner sessions reject expiry and mismatch', () => {
    const valid = createOwnerToken('connor', 'a1001');
    assert.equal(verifyOwnerToken(valid, 'connor').slug, 'connor');
    assert.throws(() => verifyOwnerToken(valid, 'tim'), /does not match/);

    const payload = Buffer.from(JSON.stringify({
        slug: 'connor', provider: 'intervals_icu', athlete_id: 'a1001', exp: Date.now() - 1
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.OWNER_SESSION_SECRET).update(payload).digest('base64url');
    assert.throws(() => verifyOwnerToken(`${payload}.${signature}`, 'connor'), /expired/);
});

test('provider requests honor rate-limit retries and mark a 401 connection for reconnect', async () => {
    let connection = await bindIntervalsConnection('connor', {
        access_token: 'provider-token', scope: 'ACTIVITY:READ', athlete: { id: 'a1001', name: 'Connor' }
    });
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = async () => {
        calls += 1;
        return calls === 1
            ? new Response('{}', { status: 429, headers: { 'Retry-After': '0' } })
            : Response.json({ ok: true });
    };
    try {
        assert.deepEqual(await intervalsFetchJson(connection, '/test'), { ok: true });
        assert.equal(calls, 2);

        global.fetch = async () => new Response('{}', { status: 401 });
        connection = await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:connor' });
        await assert.rejects(() => intervalsFetchJson(connection, '/test'), /reconnection required/);
        const stored = await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:connor' });
        assert.equal(stored.needs_reconnect, true);
        assert.equal(stored.connection_status, 'reconnect_required');
    } finally {
        global.fetch = originalFetch;
    }
});

test('duplicate full syncs upsert ICU records, skip ineligible records, reconcile deletion, and never touch Strava storage', async () => {
    await bindIntervalsConnection('connor', {
        access_token: 'provider-token', scope: 'ACTIVITY:READ', athlete: { id: 'a1001', name: 'Connor' }
    });
    await memoryStore.activities.insertOne({ strava_id: 999, user_slug: 'connor', name: 'Existing Strava Run' });
    let round = 0;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/athlete/0/activities')) {
            const eligible = round === 0 ? [fixtureActivity('i1'), fixtureActivity('i2')] : [fixtureActivity('i1', { name: 'Updated Run' })];
            return Response.json(eligible.concat([
                fixtureActivity('s1', { source: 'STRAVA' }),
                { id: 'h1', icu_athlete_id: 'a1001', source: 'GARMIN', start_date_local: '2026-01-01', _note: 'Hidden' }
            ]));
        }
        const mapMatch = parsed.pathname.match(/\/activity\/(.+)\/map$/);
        if (mapMatch) return Response.json({ latlngs: [[44.9, -93.2], [45, -93.1]] });
        const streamMatch = parsed.pathname.match(/\/activity\/(.+)\/streams\.json$/);
        if (streamMatch) return Response.json([{ type: 'speed', data: [2.5, 3.1] }]);
        const detailMatch = parsed.pathname.match(/\/activity\/(.+)$/);
        if (detailMatch) return Response.json(fixtureActivity(decodeURIComponent(detailMatch[1])));
        throw new Error(`Unexpected Intervals.icu request: ${url}`);
    };
    try {
        const first = await syncIntervalsActivities('connor');
        assert.equal(first.inserted, 2);
        assert.equal(await memoryStore.intervalsActivities.count({ user_slug: 'connor' }), 2);
        assert.equal(await memoryStore.activities.count({ user_slug: 'connor' }), 1);

        round = 1;
        const second = await syncIntervalsActivities('connor');
        assert.equal(second.inserted, 0);
        assert.equal(second.updated, 1);
        assert.equal(second.deleted, 1);
        assert.equal(await memoryStore.intervalsActivities.count({ user_slug: 'connor' }), 1);
        assert.equal((await memoryStore.intervalsActivities.findOne({ intervals_activity_id: 'i1' })).name, 'Updated Run');
        assert.equal(await memoryStore.activities.count({ user_slug: 'connor' }), 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test('an interrupted map backfill resumes from cached progress without refetching completed maps', async () => {
    await bindIntervalsConnection('connor', {
        access_token: 'provider-token', scope: 'ACTIVITY:READ', athlete: { id: 'a1001', name: 'Connor' }
    });
    const originalFetch = global.fetch;
    let failSecondMap = true;
    const mapCalls = { i1: 0, i2: 0 };
    global.fetch = async (url) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/athlete/0/activities')) {
            return Response.json([fixtureActivity('i1'), fixtureActivity('i2')]);
        }
        const mapMatch = parsed.pathname.match(/\/activity\/(i1|i2)\/map$/);
        if (mapMatch) {
            mapCalls[mapMatch[1]] += 1;
            if (mapMatch[1] === 'i2' && failSecondMap) {
                return new Response('{}', { status: 500 });
            }
            return Response.json({ latlngs: [[44.9, -93.2], [45, -93.1]] });
        }
        if (/\/streams\.json$/.test(parsed.pathname)) return Response.json([{ type: 'speed', data: [2, 3] }]);
        const detail = parsed.pathname.match(/\/activity\/(i1|i2)$/);
        if (detail) return Response.json(fixtureActivity(detail[1]));
        throw new Error(`Unexpected request: ${url}`);
    };
    try {
        await assert.rejects(() => syncIntervalsActivities('connor'), /failed with 500/);
        assert.equal(mapCalls.i1, 1);
        assert.equal(mapCalls.i2, 1);
        assert.ok((await memoryStore.intervalsActivities.findOne({ intervals_activity_id: 'i1' })).map_fetched_at);

        failSecondMap = false;
        await syncIntervalsActivities('connor');
        assert.equal(mapCalls.i1, 1);
        assert.equal(mapCalls.i2, 2);
        assert.ok((await memoryStore.intervalsActivities.findOne({ intervals_activity_id: 'i2' })).map_fetched_at);
    } finally {
        global.fetch = originalFetch;
    }
});

test('cached ICU reads are public while sync and mutations require the owner token', async (t) => {
    await bindIntervalsConnection('connor', {
        access_token: 'provider-token', scope: 'ACTIVITY:READ', athlete: { id: 'a1001', name: 'Connor' }
    });
    await memoryStore.intervalsActivities.insertOne(transformIntervalsActivity('connor', 'a1001', fixtureActivity('i-public')));
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const publicList = await request(server, '/api/intervals/activities?user=connor');
    assert.equal(publicList.status, 200);
    assert.equal(JSON.parse(publicList.body)[0].intervals_activity_id, 'i-public');

    const deniedSync = await request(server, '/api/intervals/sync/connor', { method: 'POST', body: {} });
    assert.equal(deniedSync.status, 401);

    const deniedPatch = await request(server, '/api/intervals/activities/i-public?user=connor', {
        method: 'PATCH', body: { line_color: '#112233' }
    });
    assert.equal(deniedPatch.status, 401);

    const ownerToken = createOwnerToken('connor', 'a1001');
    const allowedPatch = await request(server, '/api/intervals/activities/i-public?user=connor', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { line_color: '#112233' }
    });
    assert.equal(allowedPatch.status, 200);
    assert.equal(JSON.parse(allowedPatch.body).line_color, '#112233');

    const deniedCollection = await request(server, '/api/users/connor/collections?source=intervals_icu', {
        method: 'POST', body: { source: 'intervals_icu', name: 'ICU Routes', activity_ids: ['i-public'] }
    });
    assert.equal(deniedCollection.status, 401);
    const collectionResponse = await request(server, '/api/users/connor/collections?source=intervals_icu', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { source: 'intervals_icu', name: 'ICU Routes', activity_ids: ['i-public'] }
    });
    assert.equal(collectionResponse.status, 201);
    assert.deepEqual(JSON.parse(collectionResponse.body).activity_ids, ['i-public']);

    const deniedNote = await request(server, '/api/activities/i-public/notes?user=connor&source=intervals_icu', {
        method: 'POST', body: { elapsed_seconds: 10, text: 'Strong finish' }
    });
    assert.equal(deniedNote.status, 401);
    const noteResponse = await request(server, '/api/activities/i-public/notes?user=connor&source=intervals_icu', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { source: 'intervals_icu', elapsed_seconds: 10, text: 'Strong finish' }
    });
    assert.equal(noteResponse.status, 201);
    assert.equal(JSON.parse(noteResponse.body).activity_ref, 'i-public');

    const status = JSON.parse((await request(server, '/api/intervals/user/connor/status')).body);
    const ownerStatus = JSON.parse((await request(server, '/api/intervals/user/connor/status', {
        headers: { Authorization: `Bearer ${ownerToken}` }
    })).body);
    assert.equal(status.owner, false);
    assert.equal(ownerStatus.owner, true);

    const alias = await request(server, '/icu_map.html?user=connor');
    assert.equal(alias.status, 200);
    assert.match(alias.body, /const isIntervalsProvider/);
});

test('Intervals.icu webhook rejects an incorrect secret before processing', async (t) => {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await request(server, '/api/intervals/webhook', {
        method: 'POST', body: { id: 'i1', secret: 'wrong' }
    });
    assert.equal(response.status, 401);

    const mismatch = await request(server, '/api/intervals/webhook', {
        method: 'POST',
        body: {
            secret: process.env.INTERVALS_WEBHOOK_SECRET,
            events: [{ athlete_id: 'different-athlete', type: 'ACTIVITY_ANALYZED', activity: { id: 'i1' } }]
        }
    });
    assert.equal(mismatch.status, 403);
});
