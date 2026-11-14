const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function browserHarness() {
    const timers = new Map();
    const layers = [];
    const map = new EventEmitter();
    map.setView = () => map;
    map.hasLayer = (layer) => layers.includes(layer);
    map.removeLayer = (layer) => layers.splice(layers.indexOf(layer), 1);
    map.fire = (...args) => map.emit(...args);
    const window = {
        innerWidth: 1200,
        StravaActivityTypes: require('../../js/strava_activity_types'),
        STRAVA_CONFIG: { mapboxAccessToken: 'pk.test-public-token' },
        addEventListener() {}, removeEventListener() {},
        setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); },
        L: {
            map: () => map,
            tileLayer(url, options) {
                const layer = new EventEmitter();
                Object.assign(layer, { url, options, addTo() { layers.push(layer); return layer; } });
                return layer;
            }
        }
    };
    const context = vm.createContext({ window, console: { warn() {} } });
    for (const file of ['strava_shared.js', 'strava_animated.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js', file), 'utf8'), context);
    }
    return { window, map, layers, timers, app: window.StravaApp };
}

test('rejected map tiles switch to correctly sized OSM tiles without disturbing routes', () => {
    const { app, map, layers, timers } = browserHarness();
    app.initMap('map', [40, -90], 8);
    const primary = map._stravaBaseTileLayer;
    const route = { route: true };
    layers.push(route);
    for (let i = 0; i < 3; i++) primary.emit('tileerror');
    assert.equal(map._stravaBaseProvider, 'openstreetmap');
    assert.match(map._stravaBaseTileLayer.url, /tile\.openstreetmap\.org/);
    assert.equal(map._stravaBaseTileLayer.options.tileSize, 256);
    assert.equal(map._stravaBaseTileLayer.options.zoomOffset, 0);
    assert.equal(map._stravaBaseTileLayer.options.maxNativeZoom, 19);
    assert.ok(layers.includes(route));
    assert.equal(layers.includes(primary), false);
    assert.equal(timers.size, 0);
    primary.emit('tileerror');
    assert.equal(layers.length, 2);
});

test('stalled imagery falls back, but loaded imagery cancels the deadline', () => {
    const stalled = browserHarness();
    stalled.app.initMap('map', [40, -90], 8);
    [...stalled.timers.values()][0]();
    assert.equal(stalled.map._stravaBaseProvider, 'openstreetmap');
    const loaded = browserHarness();
    loaded.app.initMap('map', [40, -90], 8);
    loaded.map._stravaBaseTileLayer.emit('tileload');
    assert.equal(loaded.timers.size, 0);
    assert.equal(loaded.map._stravaBaseProvider, 'mapbox');
});

test('theme changes and map removal cancel stale tile callbacks', () => {
    const { app, map, timers } = browserHarness();
    app.initMap('map', [40, -90], 8);
    const oldLayer = map._stravaBaseTileLayer;
    const oldTimer = [...timers.values()][0];
    app.setMapTheme(map, 'dark');
    const newLayer = map._stravaBaseTileLayer;
    oldTimer();
    for (let i = 0; i < 3; i++) oldLayer.emit('tileerror');
    assert.equal(map._stravaBaseTileLayer, newLayer);
    assert.match(newLayer.url, /access_token=pk.test-public-token/);
    map.emit('unload');
    assert.equal(timers.size, 0);
});

test('opening animations are bounded on desktop and mobile while replay keeps its timing', () => {
    const { window } = browserHarness();
    const activity = { moving_time: 7200 };
    assert.ok(window.StravaAnimated.getDurationMs(activity) >= 10000);
    assert.ok(window.StravaAnimated.getIntroDurationMs(activity) <= 6000);
    window.innerWidth = 400;
    assert.ok(window.StravaAnimated.getIntroDurationMs(activity) <= 6000);
});

test('inline map scripts parse and the map token accessor is exported', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../strava_user.html'), 'utf8');
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
        new vm.Script(match[1]);
    }
    assert.equal(browserHarness().app.getMapAccessToken('light'), 'pk.test-public-token');
});

test('an opening route without a telemetry preview draws without a full stream request', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../../strava_user.html'), 'utf8');
    const start = html.indexOf('async function animateDescriptorWithSpeed(');
    const end = html.indexOf('function getLocationLabel(', start);
    let plainAnimations = 0;
    const route = { setStyle() {} };
    const context = vm.createContext({
        isSpeedPaletteEnabled: () => true,
        getActiveStreamColorMetricId: () => 'speed',
        getActivityPreviewStream: () => null,
        createRouteLayer: () => route,
        animateLayerPlain: async (layer) => { plainAnimations++; return layer; },
        fetchSpeedStreamForDescriptor: () => { throw new Error('Opening route must not fetch full telemetry'); }
    });
    vm.runInContext(html.slice(start, end), context);
    const result = await context.animateDescriptorWithSpeed({
        activity: { id: 'cached-workout' }, coordinates: [[40, -90], [40.01, -90.01]]
    }, { performanceMode: 'intro' });
    assert.equal(result, route);
    assert.equal(plainAnimations, 1);
});
