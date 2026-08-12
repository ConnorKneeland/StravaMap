const test = require('node:test');
const assert = require('node:assert/strict');

const ActivityKpis = require('../../js/activity_kpis');
const { transformIntervalsActivity } = require('../services/intervals_sync');
const { createColumnLookup, transformStravaExportRow } = require('../services/strava_export_import');

test('intro KPI formatters use fixed distance, elapsed-time, and elevation formats', () => {
    assert.equal(ActivityKpis.formatMetricValue('distance_meters', 7242.048, { current: true }), '+4.50 Miles');
    assert.equal(ActivityKpis.formatElapsed(46 * 60 + 30), '46min 30sec');
    assert.equal(ActivityKpis.formatElapsed(60 * 60 + 2), '1hr 0min 2sec');
    assert.equal(ActivityKpis.formatElapsed(100 * 60 * 60 + 61, { total: true }), '100hr 1min 1sec');

    const exactlyOneMileMeters = 5280 / 3.28083989501312;
    const oneMileOneFootMeters = 5281 / 3.28083989501312;
    assert.equal(ActivityKpis.formatElevationMeters(exactlyOneMileMeters, { total: true }), '5,280 Feet');
    assert.equal(ActivityKpis.formatElevationMeters(oneMileOneFootMeters, { total: true }), '1 Mile, 1 Foot');
    assert.equal(ActivityKpis.formatMetricValue('lap_count', 1, { current: true }), '+1 Lap');
    assert.equal(ActivityKpis.formatMetricValue('lap_count', 0, { current: true }), '+0 Laps');
    assert.equal(ActivityKpis.formatMetricValue('calories', 1, { total: true }), '1 Calorie');
    assert.equal(ActivityKpis.formatMetricValue('stroke_count', 1280, { current: true, mobile: true }), '+1,280 stk');
    assert.equal(ActivityKpis.formatOrdinal(1), '1st');
    assert.equal(ActivityKpis.formatOrdinal(2), '2nd');
    assert.equal(ActivityKpis.formatOrdinal(3), '3rd');
    assert.equal(ActivityKpis.formatOrdinal(11), '11th');
    assert.equal(ActivityKpis.formatOrdinal(1_021), '1,021st');
});

test('sport profiles choose additive metrics and omit missing optional values', () => {
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({ type: 'Run', distance: 1000, elapsed_time: 300, total_elevation_gain: 25 }),
        ['distance_meters', 'elapsed_time_seconds', 'elevation_gain_meters']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'Walk', distance: 1000, elapsed_time: 900, total_elevation_gain: 20,
            sport_metrics: { lap_count: 3, calories: 160 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'elevation_gain_meters', 'calories']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'Swim', distance: 1000, elapsed_time: 900,
            sport_metrics: { length_count: 40, stroke_count: 620, calories: 300 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'length_count', 'stroke_count']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'Swim', distance: 1000, elapsed_time: 900,
            sport_metrics: { lap_count: 20, calories: 300 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'calories']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'Swim', indoor: true, distance: 1000, elapsed_time: 900,
            sport_metrics: { lap_count: 20, calories: 300 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'lap_count', 'calories']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'Ride', distance: 1000, elapsed_time: 900, total_elevation_gain: 20,
            sport_metrics: { lap_count: 3, calories: 160 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'elevation_gain_meters', 'calories']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({ type: 'Yoga', elapsed_time: 1200 }),
        ['distance_meters', 'elapsed_time_seconds']
    );
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'AlpineSki', elapsed_time: 1800, total_elevation_gain: 400,
            sport_metrics: { ski_run_count: 8, calories: 520 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'elevation_gain_meters', 'ski_run_count']
    );
    assert.equal(ActivityKpis.formatMetricValue('ski_run_count', 1, { current: true }), '+1 Run');
    assert.equal(ActivityKpis.formatMetricValue('ski_run_count', 8, { total: true }), '8 Runs');
    assert.deepEqual(
        ActivityKpis.getDisplayMetricKeys({
            type: 'CustomAdventure', elapsed_time: 1800,
            sport_metrics: { calories: null, wave_count: 5 }
        }),
        ['distance_meters', 'elapsed_time_seconds', 'wave_count']
    );
});

test('Strava, Intervals.icu, and FIT-import shapes normalize explicit sport metrics', () => {
    assert.deepEqual(ActivityKpis.extractSportMetrics({ calories: 410, laps: [{}, {}, {}] }), {
        calories: 410,
        lap_count: 3
    });

    const intervalsActivity = transformIntervalsActivity('connor', 'a1001', {
        id: 'icu-1', name: 'Pool Swim', type: 'Swim', source: 'GARMIN',
        start_date: '2026-08-01T12:00:00Z', calories: 360,
        total_lengths: 40, total_strokes: 720
    });
    assert.deepEqual(intervalsActivity.sport_metrics, {
        calories: 360,
        length_count: 40,
        stroke_count: 720
    });

    const headers = ['Activity ID', 'Activity Name', 'Activity Type', 'Activity Date'];
    const imported = transformStravaExportRow(
        'connor', 'a1001',
        ['fit-1', 'Imported Strength', 'Weight Training', 'Aug 1, 2026, 07:30:00 AM'],
        createColumnLookup(headers),
        {
            stream_data: {}, stream_keys: [], stream_latlng: [], stream_time: [], stream_velocity_smooth: [],
            sport_metrics: { set_count: 5, repetition_count: 42 }
        },
        new Date('2026-08-02T00:00:00Z')
    );
    assert.deepEqual(imported.sport_metrics, { set_count: 5, repetition_count: 42 });
});

test('KPI snapshots sum non-null sport metrics and keep internal support counts', () => {
    const snapshots = ActivityKpis.buildKpiSnapshots('athlete', [
        { type: 'Swim', distance: 1000, elapsed_time: 600, calories: 250 },
        { type: 'Swim', distance: 500, elapsed_time: 300, calories: null }
    ]);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].schema_version, ActivityKpis.SNAPSHOT_SCHEMA_VERSION);
    assert.equal(snapshots[0].elapsed_time_seconds, 900);
    assert.deepEqual(snapshots[0].metrics.calories, { total: 250, supported_count: 1 });
    assert.equal(ActivityKpis.getProgressiveTotal(snapshots[0], { calories: 250 }, 'calories', 0), 0);
    assert.equal(ActivityKpis.getProgressiveTotal(snapshots[0], { calories: 250 }, 'calories', 0.5), 125);
    assert.equal(ActivityKpis.getProgressiveTotal(snapshots[0], { calories: 250 }, 'calories', 1), 250);
});

test('generic laps and intervals never become ski runs', () => {
    const genericLaps = ActivityKpis.extractSportMetrics({
        type: 'AlpineSki',
        laps: [{}, {}],
        intervals: [{ type: 'interval' }, { type: 'lap' }]
    });
    assert.equal(genericLaps.lap_count, 2);
    assert.equal(genericLaps.ski_run_count, undefined);

    const explicitRuns = ActivityKpis.extractSportMetrics({
        type: 'AlpineSki',
        intervals: [{ sport_metric_type: 'descent' }, { sport_metric_type: 'ski_run' }]
    });
    assert.equal(explicitRuns.ski_run_count, 2);
});

test('count totals advance in whole units on the route progress frame', () => {
    const snapshot = { metrics: { lap_count: { total: 12, supported_count: 2 } } };
    assert.equal(ActivityKpis.getProgressiveTotal(snapshot, { lap_count: 5 }, 'lap_count', 0), 7);
    assert.equal(ActivityKpis.getProgressiveTotal(snapshot, { lap_count: 5 }, 'lap_count', 0.5), 9);
    assert.equal(ActivityKpis.getProgressiveTotal(snapshot, { lap_count: 5 }, 'lap_count', 1), 12);
    assert.equal(
        ActivityKpis.getProgressiveTotal(
            { metrics: { elapsed_time_seconds: { total: 105, supported_count: 2 } } },
            { elapsed_time_seconds: 5 },
            'elapsed_time_seconds',
            0.5
        ),
        103
    );
});

test('odometer transitions roll increasing digits and fade new width characters', () => {
    const zeroTo248 = ActivityKpis.buildOdometerTransition('0', '248');
    assert.deepEqual(
        zeroTo248.glyphs.find((glyph) => glyph.key === 'number-0-digit-0').digitSequence,
        ['0', '1', '2', '3', '4', '5', '6', '7', '8']
    );
    assert.equal(zeroTo248.glyphs.find((glyph) => glyph.key === 'number-0-digit-2').entering, true);

    const ninetyNineTo100 = ActivityKpis.buildOdometerTransition('99', '100');
    assert.equal(ninetyNineTo100.glyphs.find((glyph) => glyph.key === 'number-0-digit-2').entering, true);
    assert.deepEqual(
        ninetyNineTo100.glyphs.find((glyph) => glyph.key === 'number-0-digit-0').digitSequence,
        ['9', '0']
    );

    const nineNineNineTo1000 = ActivityKpis.buildOdometerTransition('999', '1,000');
    assert.equal(nineNineNineTo1000.glyphs.find((glyph) => glyph.character === ',').entering, true);
    assert.equal(nineNineNineTo1000.glyphs.find((glyph) => glyph.key === 'number-0-digit-3').entering, true);

    const nineThousandTo10000 = ActivityKpis.buildOdometerTransition('9,999', '10,000');
    assert.equal(nineThousandTo10000.glyphs.find((glyph) => glyph.character === ',').entering, false);
    assert.equal(nineThousandTo10000.glyphs.find((glyph) => glyph.key === 'number-0-digit-4').entering, true);

    const decimalBoundary = ActivityKpis.buildOdometerTransition('12.9', '13.0');
    assert.deepEqual(
        decimalBoundary.glyphs.find((glyph) => glyph.key === 'number-0-digit-1').digitSequence,
        ['2', '3']
    );
    assert.deepEqual(
        decimalBoundary.glyphs.find((glyph) => glyph.key === 'number-0-digit-0').digitSequence,
        ['9', '0']
    );
    assert.equal(decimalBoundary.glyphs.find((glyph) => glyph.character === '.').changed, false);
});
