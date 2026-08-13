const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MapWidget = require('../../js/map_widget');
const MapWidgetLoader = require('../../js/map_widget_loader');
const { memoryState, memoryStore } = require('../db');
const {
    parseWidgetIndex,
    serializeScriptPayload,
    buildWidgetActivityPayload,
    addLegacyWidgetRoute,
    getWidgetActivity
} = require('../routes/widget');

test('widget query defaults to the most recent workout', () => {
    assert.deepEqual(
        MapWidget.parseWidgetRequest('https://example.com/sMap_Widget.html?user=Connor'),
        { slug: 'connor', index: 0 }
    );
});

test('widget query accepts a zero-based workout index', () => {
    assert.deepEqual(
        MapWidget.parseWidgetRequest('https://example.com/iMap_Widget.html?user=athlete_2&index=7'),
        { slug: 'athlete_2', index: 7 }
    );
});

test('widget query rejects missing slugs and invalid indices', () => {
    assert.throws(() => MapWidget.parseWidgetRequest('https://example.com/sMap_Widget.html'), /valid user slug/);
    assert.throws(() => MapWidget.parseWidgetRequest('https://example.com/sMap_Widget.html?user=connor&index=-1'), /whole number/);
    assert.throws(() => MapWidget.parseWidgetRequest('https://example.com/sMap_Widget.html?user=connor&index=1.5'), /whole number/);
    assert.throws(() => MapWidget.parseWidgetRequest('https://example.com/sMap_Widget.html?user=connor&index=100'), /too large/);
});

test('widget selects activities newest-first without mutating the response', () => {
    const activities = [
        { id: 2, start_date: '2026-07-01T12:00:00Z' },
        { id: 1, start_date: '2026-08-01T12:00:00Z' },
        { id: 3, start_date: '2026-06-01T12:00:00Z' }
    ];
    assert.equal(MapWidget.selectIndexedActivity(activities, 0).id, 1);
    assert.equal(MapWidget.selectIndexedActivity(activities, 1).id, 2);
    assert.deepEqual(activities.map((activity) => activity.id), [2, 1, 3]);
    assert.throws(() => MapWidget.selectIndexedActivity(activities, 3), /not available/);
});

test('widget fallback explicitly opts into the paginated activity-list contract', () => {
    assert.deepEqual(MapWidget.buildActivityListQuery('connor', 2), {
        user: 'connor',
        limit: 3,
        activity_list_version: 2
    });
});

test('widget KPI values use fixed workout formats', () => {
    assert.deepEqual(MapWidget.buildActivityKpis({
        moving_time: 3723,
        elapsed_time: 4000,
        distance: 1609344,
        start_date_local: '2026-08-06T07:30:00'
    }), {
        time: '01:02:03',
        distance: '1,000.00',
        date: 'Aug 6, 2026'
    });
});

test('widget KPI time falls back to elapsed time', () => {
    assert.equal(MapWidget.buildActivityKpis({ moving_time: 0, elapsed_time: 65 }).time, '00:01:05');
});

test('widget pages expose no loading frame and request a blocking backend payload', () => {
    ['sMap_Widget.html', 'iMap_Widget.html'].forEach((fileName) => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', '..', fileName), 'utf8');
        assert.doesNotMatch(html, /loading-state|Loading workout map/i);
        assert.match(html, /MapWidgetLoader\.writePayloadScript\(/);
        assert.doesNotMatch(html, /<script type="module">/);
    });

    const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'css', 'map_widget.css'), 'utf8');
    assert.match(css, /html\s*\{\s*visibility:\s*hidden;/);
    assert.match(css, /html\[data-map-widget-ready="true"\]/);
});

test('widget loader builds the provider activity-script URL from page parameters', () => {
    const url = MapWidgetLoader.buildPayloadUrl({
        location: {
            hostname: 'example.com',
            origin: 'https://example.com',
            href: 'https://example.com/iMap_Widget.html?user=Connor&index=4'
        },
        STRAVA_CONFIG: { apiBase: 'https://api.example.com/' }
    }, 'intervals');
    assert.equal(url, 'https://api.example.com/api/widget/activity-script?provider=intervals&user=Connor&index=4');
});

test('widget backend index and script serialization reject unsafe values', () => {
    assert.equal(parseWidgetIndex('0'), 0);
    assert.equal(parseWidgetIndex('42'), 42);
    assert.equal(parseWidgetIndex('100'), null);
    assert.equal(parseWidgetIndex('-1'), null);
    assert.equal(parseWidgetIndex('1.5'), null);
    assert.equal(serializeScriptPayload({ name: '</script>\u2028' }), '{"name":"\\u003c/script>\\u2028"}');
});

test('widget backend payload excludes heavy workout streams when a summary route exists', () => {
    const payload = buildWidgetActivityPayload({
        strava_id: 42,
        user_slug: 'connor',
        type: 'Run',
        distance: 5000,
        map_summary_polyline: 'encoded-route',
        stream_latlng: [[1, 2], [3, 4]],
        stream_data: { time: Array(1000).fill(0), velocity_smooth: Array(1000).fill(1) },
        laps: Array(20).fill({})
    });
    assert.deepEqual(payload.map, { summary_polyline: 'encoded-route' });
    assert.equal(payload.stream_latlng, undefined);
    assert.equal(payload.stream_data, undefined);
    assert.equal(payload.laps, undefined);
});

test('widget makes a targeted legacy route read only when a compact summary is missing', async () => {
    let readCount = 0;
    const store = {
        findOne: async (_filter, options) => {
            readCount += 1;
            assert.deepEqual(options.select, { _id: 0, 'stream_data.latlng': 1, stream_latlng: 1 });
            return { stream_data: { latlng: [[38.5, -120.2], [40.7, -120.95]] } };
        }
    };
    const legacy = await addLegacyWidgetRoute(store, { user_slug: 'tim', strava_id: 1 }, {
        user_slug: 'tim', strava_id: 1
    });
    assert.ok(legacy.summary_polyline);
    assert.equal(readCount, 1);

    const compact = { user_slug: 'tim', strava_id: 2, summary_polyline: 'already-small' };
    assert.equal(await addLegacyWidgetRoute(store, { user_slug: 'tim', strava_id: 2 }, compact), compact);
    assert.equal(readCount, 1);
});

test('preloaded widget payload must match the page request', () => {
    const request = { slug: 'connor', index: 1 };
    const activity = { id: 'activity-2' };
    assert.equal(MapWidget.getPreloadedActivity({
        provider: 'strava',
        user: 'connor',
        index: 1,
        activity
    }, request, 'strava'), activity);
    assert.equal(MapWidget.getPreloadedActivity({
        provider: 'intervals',
        user: 'connor',
        index: 1,
        activity
    }, request, 'strava'), null);
    assert.throws(() => MapWidget.getPreloadedActivity({ error: 'No workout' }, request, 'strava'), /No workout/);
});

test('widget backend selects only the requested newest-first activity', async () => {
    memoryState.activities.splice(0, memoryState.activities.length);
    await memoryStore.activities.upsertOne({ strava_id: 1 }, {
        strava_id: 1,
        user_slug: 'connor',
        start_date: '2026-08-01T12:00:00Z'
    });
    await memoryStore.activities.upsertOne({ strava_id: 2 }, {
        strava_id: 2,
        user_slug: 'connor',
        start_date: '2026-08-05T12:00:00Z'
    });
    await memoryStore.activities.upsertOne({ strava_id: 3 }, {
        strava_id: 3,
        user_slug: 'someone-else',
        start_date: '2026-08-06T12:00:00Z'
    });

    assert.equal((await getWidgetActivity('strava', 'connor', 0)).strava_id, 2);
    assert.equal((await getWidgetActivity('strava', 'connor', 1)).strava_id, 1);
    assert.equal(await getWidgetActivity('strava', 'connor', 2), null);
});
