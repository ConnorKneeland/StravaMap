const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const REQUEST_INTERVAL_MS = Math.max(1000, Number(process.env.GEOCODE_REQUEST_INTERVAL_MS || 1100));
const USER_AGENT = process.env.GEOCODE_USER_AGENT || 'StravaMap/1.0 (portfolio project reverse geocoder)';
const CONTACT_EMAIL = process.env.GEOCODE_EMAIL || '';
const locationCache = new Map();

let lastRequestAt = 0;

function wait(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function normalizeLatLng(latlng) {
    if (!Array.isArray(latlng) || latlng.length !== 2) {
        return null;
    }
    const lat = Number(latlng[0]);
    const lng = Number(latlng[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return [lat, lng];
}

function getLocationCacheKey(latlng) {
    return latlng.map(function (value) {
        return Number(value).toFixed(4);
    }).join(',');
}

function extractLocationFromResponse(payload) {
    const address = payload && payload.address ? payload.address : {};
    return {
        location_city: address.city || address.town || address.village || address.municipality || address.hamlet || address.county || '',
        location_state: address.state || address.region || address.state_district || '',
        location_country: address.country || ''
    };
}

function hasLocationFields(activity) {
    return Boolean(
        activity
        && (activity.location_city || activity.location_state || activity.location_country)
    );
}

async function reverseGeocodeLatLng(latlng) {
    const normalized = normalizeLatLng(latlng);
    if (!normalized) {
        return null;
    }
    const cacheKey = getLocationCacheKey(normalized);
    if (locationCache.has(cacheKey)) {
        return locationCache.get(cacheKey);
    }

    const timeSinceLastRequest = Date.now() - lastRequestAt;
    if (timeSinceLastRequest < REQUEST_INTERVAL_MS) {
        await wait(REQUEST_INTERVAL_MS - timeSinceLastRequest);
    }

    const url = new URL(NOMINATIM_REVERSE_URL);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(normalized[0]));
    url.searchParams.set('lon', String(normalized[1]));
    url.searchParams.set('zoom', '10');
    url.searchParams.set('addressdetails', '1');
    if (CONTACT_EMAIL) {
        url.searchParams.set('email', CONTACT_EMAIL);
    }

    lastRequestAt = Date.now();
    const response = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT
        }
    });

    if (!response.ok) {
        throw new Error(`Reverse geocode failed with ${response.status}`);
    }

    const payload = await response.json();
    const location = extractLocationFromResponse(payload);
    locationCache.set(cacheKey, location);
    return location;
}

async function enrichActivityLocation(activityStore, activity) {
    if (!activityStore || !activity || hasLocationFields(activity) || !activity.start_latlng) {
        return activity;
    }

    const location = await reverseGeocodeLatLng(activity.start_latlng);
    if (!location || (!location.location_city && !location.location_state && !location.location_country)) {
        return activity;
    }

    const updatedActivity = await activityStore.updateOne({ strava_id: Number(activity.strava_id) }, location);
    return updatedActivity || Object.assign({}, activity, location);
}

async function backfillActivityLocations(activityStore, options) {
    const opts = options || {};
    const limit = Number(opts.limit || 0);
    const filter = {};

    if (opts.userSlug) {
        filter.user_slug = String(opts.userSlug).toLowerCase();
    }

    const allActivities = await activityStore.find(filter, { sort: { start_date: -1 } });
    const candidates = allActivities.filter(function (activity) {
        return !hasLocationFields(activity) && Array.isArray(activity.start_latlng) && activity.start_latlng.length === 2;
    });
    const workItems = limit > 0 ? candidates.slice(0, limit) : candidates;

    let updatedCount = 0;
    let failedCount = 0;

    for (const activity of workItems) {
        try {
            const updated = await enrichActivityLocation(activityStore, activity);
            if (updated && hasLocationFields(updated)) {
                updatedCount += 1;
            }
        } catch (error) {
            failedCount += 1;
            console.warn('[Strava Location Backfill]', {
                user: activity.user_slug,
                strava_id: activity.strava_id,
                reason: error.message
            });
        }
    }

    return {
        requested: workItems.length,
        updated: updatedCount,
        failed: failedCount,
        remaining: Math.max(candidates.length - workItems.length, 0)
    };
}

module.exports = {
    hasLocationFields,
    reverseGeocodeLatLng,
    enrichActivityLocation,
    backfillActivityLocations
};
