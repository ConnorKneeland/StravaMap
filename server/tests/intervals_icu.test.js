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
process.env.INTERVALS_ENABLED_SLUGS = 'connor';
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
    syncIntervalsActivities,
    getIntervalsActivityStore
} = require('../services/intervals_sync');
const {
    parseCsvRows,
    createColumnLookup,
    decodeFitActivity,
    transformStravaExportRow
} = require('../services/strava_export_import');
const {
    getDataRichness,
    reconcileDuplicateActivitiesForSlug
} = require('../services/intervals_dedupe');
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
        const rawBody = Buffer.isBuffer(options.body);
        const body = options.body == null ? Buffer.alloc(0)
            : (rawBody ? options.body : Buffer.from(JSON.stringify(options.body)));
        const handle = http.request({
            hostname: '127.0.0.1',
            port: address.port,
            path,
            method: options.method || 'GET',
            headers: Object.assign({}, body.length ? {
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

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const [nameValue, contentValue] of Object.entries(entries)) {
        const name = Buffer.from(nameValue, 'utf8');
        const content = Buffer.isBuffer(contentValue) ? contentValue : Buffer.from(String(contentValue), 'utf8');
        const checksum = crc32(content);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(content.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(name.length, 26);
        localParts.push(local, name, content);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(content.length, 20);
        central.writeUInt32LE(content.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + content.length;
    }
    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(entries).length, 8);
    end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat(localParts.concat([centralDirectory, end]));
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

test('Strava export CSV parsing preserves quoted fields and uses detailed duplicate columns', () => {
    const csv = [
        'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Filename,Distance,Distance,Elapsed Time,Elapsed Time,Moving Time',
        '123,"Jul 1, 2026, 7:00:00 AM","Run, then coffee",Run,"A ""quoted"" note",activities/123.gpx,3.1,5000,30,1500,1400'
    ].join('\n');
    const rows = parseCsvRows(csv);
    const columns = createColumnLookup(rows[0]);
    const transformed = transformStravaExportRow('connor', 'a1001', rows[1], columns, null, new Date());
    assert.equal(transformed.intervals_activity_id, 'strava_export:123');
    assert.equal(transformed.name, 'Run, then coffee');
    assert.equal(transformed.description, 'A "quoted" note');
    assert.equal(transformed.distance, 5000);
    assert.equal(transformed.elapsed_time, 1500);
    assert.equal(transformed.moving_time, 1400);
    assert.equal(transformed.start_date.toISOString(), '2026-07-01T07:00:00.000Z');
});

test('official Garmin FIT decoding produces map and metric streams from record messages', async () => {
    const { Encoder, Profile } = await import('@garmin/fitsdk');
    const encoder = new Encoder();
    const toSemicircles = (degrees) => Math.round(degrees * 2147483648 / 180);
    encoder.onMesg(Profile.MesgNum.FILE_ID, {
        type: 'activity', manufacturer: 'development', product: 1,
        timeCreated: new Date('2026-07-01T12:00:00Z')
    });
    encoder.onMesg(Profile.MesgNum.RECORD, {
        timestamp: new Date('2026-07-01T12:00:00Z'),
        positionLat: toSemicircles(44.9), positionLong: toSemicircles(-93.2),
        distance: 0, enhancedSpeed: 2.5, heartRate: 140
    });
    encoder.onMesg(Profile.MesgNum.RECORD, {
        timestamp: new Date('2026-07-01T12:00:01Z'),
        positionLat: toSemicircles(45), positionLong: toSemicircles(-93.1),
        distance: 5, enhancedSpeed: 3.1, heartRate: 150
    });
    const decoded = await decodeFitActivity(Buffer.from(encoder.close()));
    assert.equal(decoded.stream_latlng.length, 2);
    assert.ok(Math.abs(decoded.stream_latlng[0][0] - 44.9) < 0.00001);
    assert.deepEqual(decoded.stream_data.heartrate, [140, 150]);
    assert.deepEqual(decoded.stream_data.velocity_smooth, [2.5, 3.1]);
    assert.ok(decoded.datapoint_count >= 8);
});

test('duplicate reconciliation keeps both source records but exposes the record with more datapoints', async () => {
    const store = getIntervalsActivityStore();
    const common = {
        user_slug: 'connor', user_id: 'connor', name: 'Morning Run', type: 'Run', sport_type: 'Run',
        activity_type_key: 'run', start_date: new Date('2026-07-01T12:00:00Z'),
        elapsed_time: 1500, moving_time: 1450, distance: 5000
    };
    await store.insertOne(Object.assign({}, common, {
        activity_key: 'intervals_icu:i-one', intervals_activity_id: 'i-one', id: 'i-one', provider: 'intervals_icu',
        stream_data: { time: [0, 1], heartrate: [140, 141] }, stream_time: [0, 1]
    }));
    await store.insertOne(Object.assign({}, common, {
        activity_key: 'strava_export:123', intervals_activity_id: 'strava_export:123', id: 'strava_export:123',
        provider: 'strava_export', import_source: 'strava_export',
        stream_data: { time: [0, 1, 2, 3], latlng: [[44.9, -93.2], [44.91, -93.19], [44.92, -93.18], [44.93, -93.17]],
            heartrate: [140, 141, 142, 143] },
        stream_time: [0, 1, 2, 3], stream_latlng: [[44.9, -93.2], [44.91, -93.19], [44.92, -93.18], [44.93, -93.17]]
    }));
    const result = await reconcileDuplicateActivitiesForSlug('connor', store);
    const records = await store.find({ user_slug: 'connor' });
    const visible = records.filter((activity) => activity.dedupe_hidden !== true);
    assert.equal(records.length, 2);
    assert.equal(result.hiddenRecords, 1);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].activity_key, 'strava_export:123');
    assert.ok(getDataRichness(visible[0]).datapoints > getDataRichness(records.find((item) => item.dedupe_hidden))
        .datapoints);
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

test('personal API keys are verified, encrypted, and bound without a static slug allowlist', async () => {
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

test('existing-map onboarding preserves Strava data, returns an owner URL, and rotates the same athlete key', async (t) => {
    const app = await createApp();
    await memoryStore.users.updateOne({ slug: 'tim' }, {
        refresh_token: 'tim-existing-strava-refresh',
        connection_status: 'connected',
        color: '#123456'
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const originalFetch = global.fetch;
    global.fetch = async () => Response.json({ id: 'i-tim', name: 'Tim Example' });
    t.after(() => { global.fetch = originalFetch; });

    const firstResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'existing',
            confirmed: true,
            slug: 'tim',
            athlete_id: 'i-tim',
            api_key: 'first-personal-key',
            return_url: 'http://localhost:3000/icu_map.html'
        }
    });
    const firstPayload = JSON.parse(firstResponse.body);
    assert.equal(firstResponse.status, 200);
    assert.equal(firstPayload.slug, 'tim');
    assert.equal(firstResponse.body.includes('first-personal-key'), false);

    const ownerUrl = new URL(firstPayload.map_url);
    const ownerToken = new URLSearchParams(ownerUrl.hash.slice(1)).get('owner_token');
    assert.equal(ownerUrl.pathname, '/icu_map.html');
    assert.equal(ownerUrl.searchParams.get('user'), 'tim');
    assert.equal(ownerUrl.searchParams.get('connected'), '1');
    assert.equal(verifyOwnerToken(ownerToken, 'tim').athlete_id, 'i-tim');

    let storedUser = await memoryStore.users.findOne({ slug: 'tim' });
    let connection = await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:tim' });
    assert.equal(storedUser.refresh_token, 'tim-existing-strava-refresh');
    assert.equal(storedUser.color, '#123456');
    assert.equal(decryptAccessToken(connection), 'first-personal-key');
    assert.equal(JSON.stringify(connection).includes('first-personal-key'), false);

    const rotationResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'existing', confirmed: true, slug: 'tim', athlete_id: 'i-tim', api_key: 'rotated-personal-key',
            return_url: 'http://localhost:3000/icu_map.html'
        }
    });
    assert.equal(rotationResponse.status, 200);
    connection = await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:tim' });
    storedUser = await memoryStore.users.findOne({ slug: 'tim' });
    assert.equal(decryptAccessToken(connection), 'rotated-personal-key');
    assert.equal(storedUser.refresh_token, 'tim-existing-strava-refresh');

    const statusResponse = await request(server, '/api/intervals/user/tim/status');
    assert.equal(statusResponse.status, 200);
    assert.equal(JSON.parse(statusResponse.body).enabled, true);
});

test('new-map onboarding validates before creating and enables the stored connection', async (t) => {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        const credentials = Buffer.from(String(options.headers.Authorization).replace(/^Basic /, ''), 'base64')
            .toString('utf8');
        if (credentials === 'API_KEY:bad-key') {
            return new Response('{}', { status: 401 });
        }
        return Response.json({ id: 'i-avery', name: 'Avery Example' });
    };
    t.after(() => { global.fetch = originalFetch; });

    const invalidNameResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Avery2', last_name: 'Onboard',
            athlete_id: 'i-avery', api_key: 'good-key'
        }
    });
    assert.equal(invalidNameResponse.status, 400);
    assert.equal(JSON.parse(invalidNameResponse.body).code, 'invalid_name');

    const invalidKeyResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Avery', last_name: 'Onboard',
            athlete_id: 'i-avery', api_key: 'bad-key',
            return_url: 'http://localhost:3000/icu_map.html'
        }
    });
    assert.equal(invalidKeyResponse.status, 401);
    assert.equal(await memoryStore.users.findOne({ slug: 'averyonboard' }), null);
    assert.equal(await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:averyonboard' }), null);

    const mismatchResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Mismatch', last_name: 'Friend',
            athlete_id: 'i-someone-else', api_key: 'good-key',
            return_url: 'http://localhost:3000/icu_map.html'
        }
    });
    assert.equal(mismatchResponse.status, 409);
    assert.equal(JSON.parse(mismatchResponse.body).code, 'athlete_mismatch');
    assert.equal(await memoryStore.users.findOne({ slug: 'mismatchfriend' }), null);

    const response = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Avery', last_name: 'Onboard',
            athlete_id: 'i-avery', api_key: 'good-key',
            return_url: 'http://localhost:3000/icu_map.html'
        }
    });
    const payload = JSON.parse(response.body);
    assert.equal(response.status, 201);
    assert.equal(payload.slug, 'averyonboard');
    assert.equal(response.body.includes('good-key'), false);

    const user = await memoryStore.users.findOne({ slug: 'averyonboard' });
    const connection = await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:averyonboard' });
    assert.equal(user.display_name, 'Avery');
    assert.equal(user.connection_status, 'not_connected');
    assert.equal(connection.provider_athlete_id, 'i-avery');
    assert.equal(decryptAccessToken(connection), 'good-key');

    const statusResponse = await request(server, '/api/intervals/user/averyonboard/status');
    assert.equal(statusResponse.status, 200);
    assert.equal(JSON.parse(statusResponse.body).connected, true);

    const duplicateResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Avery', last_name: 'Onboard',
            athlete_id: 'i-avery', api_key: 'good-key'
        }
    });
    assert.equal(duplicateResponse.status, 409);
    assert.equal(JSON.parse(duplicateResponse.body).code, 'slug_taken');
});

test('onboarding rejects unknown and conflicting ownership and rolls back a failed credential write', async (t) => {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const profiles = {
        'shared-key': { id: 'i-shared', name: 'Shared Athlete' },
        'second-shared-key': { id: 'i-shared', name: 'Shared Athlete' },
        'tim-first-key': { id: 'i-tim-one', name: 'Tim One' },
        'tim-second-key': { id: 'i-tim-two', name: 'Tim Two' },
        'rollback-key': { id: 'i-rollback', name: 'Rollback Friend' }
    };
    const originalFetch = global.fetch;
    const originalEncryptionKey = process.env.PROVIDER_TOKEN_ENCRYPTION_KEY;
    global.fetch = async (url, options) => {
        const credentials = Buffer.from(String(options.headers.Authorization).replace(/^Basic /, ''), 'base64')
            .toString('utf8');
        return Response.json(profiles[credentials.replace(/^API_KEY:/, '')]);
    };
    t.after(() => {
        global.fetch = originalFetch;
        process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
    });

    const confirmationResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: { mode: 'existing', slug: 'tim', athlete_id: 'i-shared', api_key: 'shared-key' }
    });
    assert.equal(confirmationResponse.status, 400);
    assert.equal(JSON.parse(confirmationResponse.body).code, 'confirmation_required');

    const invalidSlugResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: { mode: 'existing', confirmed: true, slug: 'not a valid slug!', athlete_id: 'i-shared', api_key: 'shared-key' }
    });
    assert.equal(invalidSlugResponse.status, 400);
    assert.equal(JSON.parse(invalidSlugResponse.body).code, 'invalid_slug');

    const missingResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: { mode: 'existing', confirmed: true, slug: 'not-a-real-map', athlete_id: 'i-shared', api_key: 'shared-key' }
    });
    assert.equal(missingResponse.status, 404);
    assert.equal(JSON.parse(missingResponse.body).code, 'user_not_found');

    const firstResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'First', last_name: 'Friend',
            athlete_id: 'i-shared', api_key: 'shared-key'
        }
    });
    assert.equal(firstResponse.status, 201);
    const secondResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Second', last_name: 'Friend',
            athlete_id: 'i-shared', api_key: 'second-shared-key'
        }
    });
    assert.equal(secondResponse.status, 409);
    assert.equal(JSON.parse(secondResponse.body).code, 'athlete_already_connected');
    assert.equal(await memoryStore.users.findOne({ slug: 'secondfriend' }), null);

    const timFirstResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: { mode: 'existing', confirmed: true, slug: 'tim', athlete_id: 'i-tim-one', api_key: 'tim-first-key' }
    });
    assert.equal(timFirstResponse.status, 200);
    const timSecondResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: { mode: 'existing', confirmed: true, slug: 'tim', athlete_id: 'i-tim-two', api_key: 'tim-second-key' }
    });
    assert.equal(timSecondResponse.status, 409);
    assert.equal(JSON.parse(timSecondResponse.body).code, 'slug_already_connected');

    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = '';
    const rollbackResponse = await request(server, '/api/intervals/register', {
        method: 'POST',
        body: {
            mode: 'new', confirmed: true, first_name: 'Rollback', last_name: 'Friend',
            athlete_id: 'i-rollback', api_key: 'rollback-key'
        }
    });
    process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
    assert.equal(rollbackResponse.status, 503);
    assert.equal(await memoryStore.users.findOne({ slug: 'rollbackfriend' }), null);
    assert.equal(await memoryStore.providerConnections.findOne({ connection_key: 'intervals_icu:rollbackfriend' }), null);
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

test('owner ZIP upload imports activities into ICU storage, is repeatable, and never mutates Strava storage', async (t) => {
    await memoryStore.providerConnections.insertOne({
        connection_key: 'intervals_icu:connor', user_slug: 'connor', provider: 'intervals_icu',
        provider_athlete_id: 'a1001', auth_type: 'api_key', connection_status: 'connected', needs_reconnect: false
    });
    await memoryStore.activities.insertOne({
        strava_id: 123, user_slug: 'connor', user_id: 'connor', name: 'Only historical copy',
        description: 'Must never be changed by ICU ZIP import', stream_data: { time: [0, 1, 2] }
    });
    const csv = [
        'Activity ID,Activity Date,Activity Name,Activity Type,Filename,Elapsed Time,Moving Time,Distance',
        '123,"Jul 1, 2026, 7:00:00 AM",Morning Run,Run,activities/123.gpx,2,2,15'
    ].join('\n');
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="44.9" lon="-93.2"><ele>250</ele><time>2026-07-01T07:00:00Z</time></trkpt>
      <trkpt lat="44.9001" lon="-93.1999"><ele>251</ele><time>2026-07-01T07:00:01Z</time></trkpt>
      <trkpt lat="44.9002" lon="-93.1998"><ele>252</ele><time>2026-07-01T07:00:02Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const archive = buildStoredZip({ 'activities.csv': csv, 'activities/123.gpx': gpx });
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const ownerToken = createOwnerToken('connor', 'a1001');
    const options = {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/zip' },
        body: archive
    };
    const first = await request(server, '/api/intervals/import/strava-export/connor', options);
    assert.equal(first.status, 200, first.body);
    assert.equal(JSON.parse(first.body).inserted, 1);
    const imported = await memoryStore.intervalsActivities.findOne({
        user_slug: 'connor', intervals_activity_id: 'strava_export:123'
    });
    assert.ok(imported);
    assert.equal(imported.import_source, 'strava_export');
    assert.equal(imported.stream_latlng.length, 3);

    const second = await request(server, '/api/intervals/import/strava-export/connor', options);
    assert.equal(second.status, 200, second.body);
    assert.equal(JSON.parse(second.body).inserted, 0);
    assert.equal(JSON.parse(second.body).updated, 1);
    assert.equal(await memoryStore.intervalsActivities.count({ user_slug: 'connor' }), 1);

    const historical = await memoryStore.activities.findOne({ strava_id: 123, user_slug: 'connor' });
    assert.ok(historical);
    assert.equal(historical.name, 'Only historical copy');
    assert.equal(historical.description, 'Must never be changed by ICU ZIP import');
    assert.deepEqual(historical.stream_data.time, [0, 1, 2]);
});

test('full Intervals sync never hydrates or deletes Strava-export records', async () => {
    await bindIntervalsConnection('connor', {
        access_token: 'provider-token', scope: 'ACTIVITY:READ', athlete: { id: 'a1001', name: 'Connor' }
    });
    await memoryStore.intervalsActivities.insertOne({
        activity_key: 'strava_export:keep-me', intervals_activity_id: 'strava_export:keep-me', id: 'strava_export:keep-me',
        user_slug: 'connor', user_id: 'connor', provider: 'strava_export', import_source: 'strava_export',
        name: 'Historical Export', type: 'Run', sport_type: 'Run', activity_type_key: 'run',
        start_date: new Date('2024-01-01T12:00:00Z'), stream_data: { time: [0, 1, 2] }, source_datapoint_count: 3
    });
    await memoryStore.activities.insertOne({ strava_id: 444, user_slug: 'connor', user_id: 'connor', name: 'Strava history' });
    const originalFetch = global.fetch;
    const requestedPaths = [];
    global.fetch = async (url) => {
        requestedPaths.push(new URL(String(url)).pathname);
        return Response.json([]);
    };
    try {
        await syncIntervalsActivities('connor');
        assert.ok(await memoryStore.intervalsActivities.findOne({ activity_key: 'strava_export:keep-me' }));
        assert.ok(await memoryStore.activities.findOne({ strava_id: 444, user_slug: 'connor' }));
        assert.deepEqual(requestedPaths, ['/api/v1/athlete/0/activities']);
    } finally {
        global.fetch = originalFetch;
    }
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
