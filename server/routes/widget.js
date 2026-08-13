const express = require('express');
const { normalizeSlug } = require('../services/connection');
const { getActivityStore } = require('../services/sync');
const { getIntervalsActivityStore } = require('../services/intervals_sync');
const { isIntervalsSlugAccessible } = require('../services/intervals_auth');

const router = express.Router();

function parseWidgetIndex(value) {
    const raw = String(value === undefined || value === null || value === '' ? '0' : value).trim();
    if (!/^\d+$/.test(raw)) {
        return null;
    }
    const index = Number(raw);
    return Number.isSafeInteger(index) ? index : null;
}

function serializeScriptPayload(payload) {
    return JSON.stringify(payload)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function sendPayload(res, payload) {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.type('application/javascript');
    res.send(`globalThis.__MAP_WIDGET_PAYLOAD__ = ${serializeScriptPayload(payload)};`);
}

function buildWidgetActivityPayload(activity) {
    const record = activity || {};
    const recordMap = record.map && typeof record.map === 'object' ? record.map : {};
    const summaryPolyline = recordMap.summary_polyline
        || record.map_summary_polyline
        || record.summary_polyline
        || recordMap.polyline
        || record.map_polyline
        || '';
    const streamLatLng = Array.isArray(record.stream_latlng) && record.stream_latlng.length
        ? record.stream_latlng
        : (record.stream_data && Array.isArray(record.stream_data.latlng) ? record.stream_data.latlng : []);
    const payload = {
        id: record.id || record.strava_id || record.intervals_activity_id,
        strava_id: record.strava_id,
        intervals_activity_id: record.intervals_activity_id,
        user_slug: record.user_slug,
        name: record.name,
        type: record.type,
        sport_type: record.sport_type,
        activity_type_override: record.activity_type_override,
        activity_type_override_label: record.activity_type_override_label,
        start_date: record.start_date,
        start_date_local: record.start_date_local,
        moving_time: record.moving_time,
        elapsed_time: record.elapsed_time,
        distance: record.distance,
        line_color: record.line_color || record.custom_line_color,
        line_thickness: record.line_thickness ?? record.line_weight ?? record.custom_line_thickness,
        line_opacity: record.line_opacity ?? record.custom_line_opacity
    };
    if (summaryPolyline) {
        payload.map = { summary_polyline: summaryPolyline };
    } else if (streamLatLng.length) {
        payload.stream_latlng = streamLatLng;
    }
    return payload;
}

async function getWidgetActivity(provider, slug, index) {
    if (provider === 'intervals') {
        if (!(await isIntervalsSlugAccessible(slug))) {
            throw new Error('Intervals.icu is not enabled for this user.');
        }
        const activities = (await getIntervalsActivityStore().find(
            { user_slug: slug },
            { sort: { start_date: -1 } }
        )).filter((activity) => activity.dedupe_hidden !== true);
        return activities[index] || null;
    }

    const activities = await getActivityStore().find(
        { user_slug: slug },
        { sort: { start_date: -1 }, limit: index + 1 }
    );
    return activities[index] || null;
}

router.get('/widget/activity-script', async (req, res) => {
    const provider = String(req.query.provider || '').trim().toLowerCase();
    const slug = normalizeSlug(req.query.user);
    const index = parseWidgetIndex(req.query.index);

    if (!['strava', 'intervals'].includes(provider)) {
        sendPayload(res, { error: 'A valid widget provider is required.' });
        return;
    }
    if (!slug) {
        sendPayload(res, { error: 'Add a valid user slug with ?user=<slug>.' });
        return;
    }
    if (index === null) {
        sendPayload(res, { error: 'The index must be a whole number of 0 or greater.' });
        return;
    }

    try {
        const activity = await getWidgetActivity(provider, slug, index);
        if (!activity) {
            sendPayload(res, { error: `Workout index ${index} is not available for this user.` });
            return;
        }
        sendPayload(res, {
            provider,
            user: slug,
            index,
            activity: buildWidgetActivityPayload(activity)
        });
    } catch (error) {
        sendPayload(res, {
            error: error && error.message ? error.message : 'The selected workout could not be loaded.'
        });
    }
});

module.exports = {
    router,
    parseWidgetIndex,
    serializeScriptPayload,
    buildWidgetActivityPayload,
    getWidgetActivity
};
