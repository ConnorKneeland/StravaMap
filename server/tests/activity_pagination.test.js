const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
process.env.MONGODB_URI = '';
process.env.APP_BASE_URL = 'http://localhost:3000';
process.env.STRAVA_REDIRECT_URI = 'http://localhost:3000/api/strava/callback';
process.env.PRIMARY_STRAVA_CLIENT_ID = '999001';
process.env.PRIMARY_STRAVA_CLIENT_SECRET = 'primary-test-secret';
process.env.OAUTH_STATE_SECRET = 'pagination-test-state-secret-with-at-least-thirty-two-characters';
process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'pagination-test-webhook-token';
process.env.INTERVALS_ENABLED_SLUGS = 'connor';
process.env.PROVIDER_TOKEN_ENCRYPTION_KEY = 'pagination-provider-encryption-key-with-32-characters';
process.env.OWNER_SESSION_SECRET = 'pagination-owner-session-secret-with-at-least-thirty-two-characters';
process.env.ACTIVITY_LIST_V2_ENABLED = 'true';

const { memoryState, memoryStore } = require('../db');
const { createApp } = require('../index');
const { encodeActivityCursor, decodeActivityCursor } = require('../activity_pagination');

function resetMemory() {
    Object.keys(memoryState).forEach((key) => memoryState[key].splice(0, memoryState[key].length));
}

function request(server, path) {
    return new Promise((resolve, reject) => {
        const address = server.address();
        const handle = http.request({
            hostname: '127.0.0.1',
            port: address.port,
            path,
            method: 'GET'
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                status: response.statusCode,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        handle.on('error', reject);
        handle.end();
    });
}

async function startServer(t) {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return server;
}

test.beforeEach(resetMemory);

test('V2 request opt-in paginates beyond the first three while the rollout default remains legacy', async (t) => {
    const priorValue = process.env.ACTIVITY_LIST_V2_ENABLED;
    process.env.ACTIVITY_LIST_V2_ENABLED = 'false';
    t.after(() => {
        process.env.ACTIVITY_LIST_V2_ENABLED = priorValue;
    });
    for (let index = 1; index <= 5; index += 1) {
        await memoryStore.activities.insertOne({
            strava_id: 80 + index, user_id: 'tim', user_slug: 'tim', name: `Legacy-compatible run ${index}`,
            type: 'Run', activity_type_key: 'run', start_date: `2026-08-0${index}T12:00:00.000Z`,
            stream_data: { time: [0, 1], latlng: [[44, -93], [44.1, -93.1]] }
        });
    }
    const server = await startServer(t);
    const response = await request(server, '/api/activities?user=tim&limit=3&include_preview=1');
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(payload));
    assert.equal(payload.length, 3);
    assert.deepEqual(payload[0].stream_data.time, [0, 1]);

    const firstV2Response = await request(
        server,
        '/api/activities?user=tim&limit=3&include_preview=1&activity_list_version=2'
    );
    const firstV2 = JSON.parse(firstV2Response.body);
    assert.equal(firstV2Response.status, 200);
    assert.equal(firstV2.activities.length, 3);
    assert.equal(firstV2.pagination.has_more, true);
    assert.ok(firstV2.pagination.next_cursor);
    assert.equal(firstV2.activities[0].stream_data, undefined);
    assert.equal(firstV2.activities[0].stream_preview, undefined);

    const secondV2Response = await request(
        server,
        `/api/activities?user=tim&limit=3&activity_list_version=2&cursor=${encodeURIComponent(firstV2.pagination.next_cursor)}`
    );
    const secondV2 = JSON.parse(secondV2Response.body);
    assert.equal(secondV2Response.status, 200);
    assert.equal(secondV2.activities.length, 2);
    assert.equal(secondV2.pagination.has_more, false);
    assert.equal(new Set(firstV2.activities.concat(secondV2.activities).map((activity) => activity.strava_id)).size, 5);
});

test('decoded activity cursors retain a BSON-compatible Date value', () => {
    const cursor = encodeActivityCursor('strava', {
        start_date: '2026-08-01T12:00:00.000Z',
        strava_id: 123
    }, 'strava_id');
    const decoded = decodeActivityCursor(cursor, 'strava');

    assert.ok(decoded.date instanceof Date);
    assert.equal(decoded.date.toISOString(), '2026-08-01T12:00:00.000Z');
    assert.equal(decoded.id, 123);
});

test('Strava summaries use stable cursor pagination and omit full streams', async (t) => {
    const sameDate = '2026-08-01T12:00:00.000Z';
    for (const [stravaId, startDate] of [
        [1, '2026-09-01T12:00:00.000Z'],
        [101, sameDate],
        [103, sameDate],
        [102, sameDate],
        [99, '2026-07-01T12:00:00.000Z']
    ]) {
        await memoryStore.activities.insertOne({
            strava_id: stravaId,
            user_id: 'tim',
            user_slug: 'tim',
            name: `Run ${stravaId}`,
            type: 'Run',
            sport_type: 'Run',
            activity_type_key: 'run',
            start_date: startDate,
            distance: 5000,
            stream_data: { time: Array(1000).fill(1), latlng: Array(1000).fill([44, -93]) },
            stream_latlng: Array(1000).fill([44, -93]),
            stream_preview: {
                time: Array(600).fill(1),
                latlng: Array(600).fill([44, -93]),
                arbitrary_large_field: Array(600).fill('omit-me')
            },
            stream_preview_metadata: { schema_version: 1, point_count: 400 }
        });
    }
    const server = await startServer(t);
    const firstResponse = await request(server, '/api/activities?user=tim&limit=3&include_preview=1');
    const first = JSON.parse(firstResponse.body);

    assert.equal(firstResponse.status, 200);
    assert.deepEqual(first.activities.map((activity) => activity.strava_id), [1, 103, 102]);
    assert.equal(first.pagination.limit, 3);
    assert.equal(first.pagination.has_more, true);
    assert.ok(first.pagination.next_cursor);
    assert.equal(first.activities[0].stream_data, undefined);
    assert.equal(first.activities[0].stream_latlng, undefined);
    assert.equal(first.activities[0].stream_preview.time.length, 400);
    assert.equal(first.activities[0].stream_preview.arbitrary_large_field, undefined);

    const secondResponse = await request(
        server,
        `/api/activities?user=tim&limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`
    );
    const second = JSON.parse(secondResponse.body);
    assert.deepEqual(second.activities.map((activity) => activity.strava_id), [101, 99]);
    assert.equal(second.pagination.has_more, false);
    assert.equal(second.pagination.next_cursor, null);
});

test('activity pagination validates limits, cursors, and bounded ID lookups', async (t) => {
    for (let id = 1; id <= 3; id += 1) {
        await memoryStore.activities.insertOne({
            strava_id: id,
            user_id: 'tim',
            user_slug: 'tim',
            name: `Run ${id}`,
            type: 'Run',
            activity_type_key: 'run',
            start_date: `2026-08-0${id}T12:00:00.000Z`
        });
    }
    const server = await startServer(t);
    const selectedResponse = await request(server, '/api/activities?user=tim&ids=1,3');
    const selected = JSON.parse(selectedResponse.body);
    assert.deepEqual(selected.activities.map((activity) => activity.strava_id), [3, 1]);

    const invalidLimit = await request(server, '/api/activities?user=tim&limit=101');
    assert.equal(invalidLimit.status, 400);
    assert.equal(JSON.parse(invalidLimit.body).code, 'invalid_activity_limit');

    const oversizedPreview = await request(server, '/api/activities?user=tim&limit=4&include_preview=1');
    assert.equal(oversizedPreview.status, 400);
    assert.equal(JSON.parse(oversizedPreview.body).code, 'activity_preview_limit_exceeded');

    const invalidCursor = await request(server, '/api/activities?user=tim&cursor=not-a-real-cursor');
    assert.equal(invalidCursor.status, 400);
    assert.equal(JSON.parse(invalidCursor.body).code, 'invalid_activity_cursor');

    const tooManyIds = Array.from({ length: 101 }, (_, index) => index + 1).join(',');
    const invalidIds = await request(server, `/api/activities?user=tim&ids=${tooManyIds}`);
    assert.equal(invalidIds.status, 400);
    assert.equal(JSON.parse(invalidIds.body).code, 'too_many_activity_ids');
});

test('Intervals summaries remain provider-isolated and omit hidden and detailed data', async (t) => {
    await memoryStore.activities.insertOne({
        strava_id: 9001, user_id: 'connor', user_slug: 'connor', name: 'Strava only',
        type: 'Run', activity_type_key: 'run', start_date: '2026-08-04T12:00:00.000Z'
    });
    for (const [id, date, hidden] of [
        ['icu-1', '2026-08-01T12:00:00.000Z', false],
        ['icu-3', '2026-08-03T12:00:00.000Z', false],
        ['icu-2', '2026-08-02T12:00:00.000Z', true]
    ]) {
        await memoryStore.intervalsActivities.insertOne({
            activity_key: `intervals:${id}`,
            intervals_activity_id: id,
            id,
            user_id: 'connor',
            user_slug: 'connor',
            name: `Intervals ${id}`,
            type: 'Run',
            activity_type_key: 'run',
            start_date: date,
            dedupe_hidden: hidden,
            stream_data: { time: Array(2000).fill(1) },
            intervals: Array(500).fill({ duration: 30 })
        });
    }
    const server = await startServer(t);
    const response = await request(server, '/api/intervals/activities?user=connor&ids=icu-1,icu-2,icu-3');
    const payload = JSON.parse(response.body);

    assert.equal(response.status, 200);
    assert.deepEqual(payload.activities.map((activity) => activity.intervals_activity_id), ['icu-3', 'icu-1']);
    assert.ok(payload.activities.every((activity) => activity.strava_id === undefined));
    assert.ok(payload.activities.every((activity) => activity.stream_data === undefined));
    assert.ok(payload.activities.every((activity) => activity.intervals === undefined));
});

test('effective activity-type filters honor overrides across cursor pages', async (t) => {
    for (const activity of [
        {
            strava_id: 1, user_id: 'tim', user_slug: 'tim', name: 'Newest overridden ride',
            type: 'Run', sport_type: 'Run', activity_type_key: 'ride', activity_type_override: 'ride',
            start_date: '2026-09-01T12:00:00.000Z'
        },
        {
            strava_id: 103, user_id: 'tim', user_slug: 'tim', name: 'Ride 103',
            type: 'Ride', sport_type: 'Ride', activity_type_key: 'ride',
            start_date: '2026-08-01T12:00:00.000Z'
        },
        {
            strava_id: 102, user_id: 'tim', user_slug: 'tim', name: 'Ride 102',
            type: 'Ride', sport_type: 'Ride', activity_type_key: 'ride',
            start_date: '2026-08-01T12:00:00.000Z'
        },
        {
            strava_id: 101, user_id: 'tim', user_slug: 'tim', name: 'Overridden away',
            type: 'Ride', sport_type: 'Ride', activity_type_key: 'run', activity_type_override: 'run',
            start_date: '2026-08-01T12:00:00.000Z'
        }
    ]) await memoryStore.activities.insertOne(activity);
    const server = await startServer(t);
    const first = JSON.parse((await request(server, '/api/activities?user=tim&type=ride&limit=2')).body);
    assert.deepEqual(first.activities.map((activity) => activity.strava_id), [1, 103]);
    assert.equal(first.pagination.has_more, true);
    const second = JSON.parse((await request(
        server,
        `/api/activities?user=tim&type=ride&limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`
    )).body);
    assert.deepEqual(second.activities.map((activity) => activity.strava_id), [102]);
    assert.equal(second.pagination.has_more, false);
});

test('detail responses omit samples and stream responses expose arrays exactly once', async (t) => {
    await memoryStore.activities.insertOne({
        strava_id: 123,
        user_id: 'tim',
        user_slug: 'tim',
        name: 'Detailed run',
        type: 'Run',
        activity_type_key: 'run',
        start_date: '2026-08-01T12:00:00.000Z',
        stream_data: { time: [0, 1], latlng: [[44, -93], [44.1, -93.1]] },
        stream_latlng: [[44, -93], [44.1, -93.1]]
    });
    await memoryStore.activityStreams.insertOne({
        user_slug: 'tim',
        strava_id: 123,
        stream_data: { time: [0, 1], latlng: [[44, -93], [44.1, -93.1]] },
        stream_keys: ['time', 'latlng'],
        stream_requested_keys: ['time', 'latlng'],
        stream_resolution: 'high',
        stream_series_type: 'time'
    });
    await memoryStore.intervalsActivities.insertOne({
        activity_key: 'intervals:icu-123',
        intervals_activity_id: 'icu-123',
        id: 'icu-123',
        user_id: 'connor',
        user_slug: 'connor',
        name: 'Intervals detailed run',
        type: 'Run',
        activity_type_key: 'run',
        start_date: '2026-08-01T12:00:00.000Z',
        stream_data: { time: [0, 1], heartrate: [140, 141] },
        stream_time: [0, 1]
    });
    await memoryStore.intervalsActivityStreams.insertOne({
        user_slug: 'connor',
        intervals_activity_id: 'icu-123',
        stream_data: { time: [0, 1], heartrate: [140, 141] },
        stream_keys: ['time', 'heartrate'],
        stream_requested_keys: ['time', 'heartrate'],
        stream_resolution: 'high',
        stream_series_type: 'time'
    });
    const server = await startServer(t);
    const detailResponse = await request(server, '/api/activities/123?user=tim');
    const detail = JSON.parse(detailResponse.body);
    assert.equal(detail.stream_data, undefined);
    assert.equal(detail.stream_latlng, undefined);

    const streamsResponse = await request(server, '/api/activities/123/streams?user=tim&keys=time,latlng');
    const streams = JSON.parse(streamsResponse.body);
    assert.deepEqual(streams.streams.time, [0, 1]);
    assert.equal(streams.stream_data, undefined);
    assert.equal(streams.stream_time, undefined);
    assert.equal(streams.time, undefined);
    assert.equal(streams.cached, true);

    const intervalsDetailResponse = await request(
        server, '/api/intervals/activities/icu-123?user=connor'
    );
    const intervalsDetail = JSON.parse(intervalsDetailResponse.body);
    assert.equal(intervalsDetail.stream_data, undefined);
    assert.equal(intervalsDetail.stream_time, undefined);

    const intervalsStreamsResponse = await request(
        server, '/api/intervals/activities/icu-123/streams?user=connor'
    );
    const intervalsStreams = JSON.parse(intervalsStreamsResponse.body);
    assert.deepEqual(intervalsStreams.streams.heartrate, [140, 141]);
    assert.equal(intervalsStreams.stream_data, undefined);
    assert.equal(intervalsStreams.stream_time, undefined);
    assert.equal(intervalsStreams.time, undefined);
    assert.equal(intervalsStreams.cached, true);
});

test('canonical Strava stream records remain cache hits without requested-key metadata', async (t) => {
    await memoryStore.activities.insertOne({
        strava_id: 777, user_id: 'tim', user_slug: 'tim', name: 'Cached run',
        type: 'Run', activity_type_key: 'run', start_date: '2026-08-01T12:00:00.000Z'
    });
    await memoryStore.activityStreams.insertOne({
        user_slug: 'tim', strava_id: 777,
        stream_data: {
            time: [0, 1],
            latlng: [[44, -93], [44.1, -93.1]],
            velocity_smooth: [2, 3]
        },
        stream_requested_keys: [],
        stream_resolution: 'high',
        stream_series_type: 'time'
    });
    const server = await startServer(t);
    const response = await request(
        server,
        '/api/activities/777/streams?user=tim&keys=time,latlng,velocity_smooth'
    );
    const payload = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.equal(payload.cached, true);
    assert.deepEqual(payload.streams.velocity_smooth, [2, 3]);
});
