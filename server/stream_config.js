const STRAVA_STREAM_REGISTRY = Object.freeze({
    time: { key: 'time', type: 'number[]', unit: 'seconds', availability: 'activity_stream' },
    distance: { key: 'distance', type: 'number[]', unit: 'meters', availability: 'activity_stream' },
    latlng: { key: 'latlng', type: '[lat,lng][]', unit: 'coordinates', availability: 'activity_stream' },
    altitude: { key: 'altitude', type: 'number[]', unit: 'meters', availability: 'activity_stream' },
    velocity_smooth: { key: 'velocity_smooth', type: 'number[]', unit: 'meters/second', availability: 'activity_stream' },
    heartrate: { key: 'heartrate', type: 'number[]', unit: 'bpm', availability: 'activity_stream' },
    cadence: { key: 'cadence', type: 'number[]', unit: 'rpm', availability: 'activity_stream' },
    watts: { key: 'watts', type: 'number[]', unit: 'watts', availability: 'activity_stream' },
    temp: { key: 'temp', type: 'number[]', unit: 'Celsius', availability: 'activity_stream' },
    moving: { key: 'moving', type: 'boolean[]', unit: 'boolean', availability: 'activity_stream' },
    grade_smooth: { key: 'grade_smooth', type: 'number[]', unit: 'percent grade', availability: 'activity_stream' }
});

const STRAVA_STREAM_PROFILES = Object.freeze({
    route: ['latlng', 'time'],
    speed: ['latlng', 'velocity_smooth', 'time'],
    full: Object.keys(STRAVA_STREAM_REGISTRY)
});

const DEFAULT_STREAM_PROFILE = 'speed';
const DEFAULT_STREAM_RESOLUTION = 'high';
const DEFAULT_STREAM_SERIES_TYPE = 'time';

function normalizeStreamKeys(keys) {
    const values = Array.isArray(keys)
        ? keys
        : String(keys || '').split(',');
    const normalized = [];
    values.forEach((value) => {
        const key = String(value || '').trim();
        if (STRAVA_STREAM_REGISTRY[key] && !normalized.includes(key)) {
            normalized.push(key);
        }
    });
    return normalized;
}

function getStreamKeysForProfile(profile) {
    const profileId = String(profile || DEFAULT_STREAM_PROFILE).trim();
    return (STRAVA_STREAM_PROFILES[profileId] || STRAVA_STREAM_PROFILES[DEFAULT_STREAM_PROFILE]).slice();
}

function normalizeStreamRequest(options = {}) {
    const explicitKeys = normalizeStreamKeys(options.keys);
    const profile = String(options.profile || DEFAULT_STREAM_PROFILE).trim();
    const keys = explicitKeys.length ? explicitKeys : getStreamKeysForProfile(profile);
    return {
        profile: STRAVA_STREAM_PROFILES[profile] ? profile : DEFAULT_STREAM_PROFILE,
        keys: keys,
        resolution: String(options.resolution || DEFAULT_STREAM_RESOLUTION),
        seriesType: String(options.seriesType || options.series_type || DEFAULT_STREAM_SERIES_TYPE)
    };
}

module.exports = {
    STRAVA_STREAM_REGISTRY,
    STRAVA_STREAM_PROFILES,
    DEFAULT_STREAM_PROFILE,
    DEFAULT_STREAM_RESOLUTION,
    DEFAULT_STREAM_SERIES_TYPE,
    normalizeStreamKeys,
    getStreamKeysForProfile,
    normalizeStreamRequest
};
