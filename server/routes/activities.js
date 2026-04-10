const express = require('express');
const {
    syncUserActivities,
    ensureUserForSync,
    fetchActivityDetail,
    fetchActivityStreams,
    getUserStore,
    getActivityStore
} = require('../services/sync');

const router = express.Router();

function buildActivityFilter(query) {
    const filter = {};
    if (query.user) {
        filter.user_slug = query.user;
    }
    if (query.type) {
        filter.type = query.type;
    }
    if (query.from || query.to) {
        filter.start_date = {};
        if (query.from) {
            filter.start_date.$gte = query.from;
        }
        if (query.to) {
            filter.start_date.$lte = query.to;
        }
    }
    return filter;
}

function isTruthy(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

function buildActivityStreamResponse(activity, cached) {
    return {
        strava_id: activity.strava_id,
        stream_resolution: activity.stream_resolution || 'medium',
        stream_series_type: activity.stream_series_type || 'time',
        stream_latlng: activity.stream_latlng || [],
        stream_velocity_smooth: activity.stream_velocity_smooth || [],
        stream_time: activity.stream_time || [],
        stream_fetched_at: activity.stream_fetched_at || null,
        cached: Boolean(cached)
    };
}

router.post('/sync/:slug', async (req, res) => {
    const user = await ensureUserForSync(req.params.slug);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(await syncUserActivities(user));
});

router.get('/activities', async (req, res) => {
    res.json(await getActivityStore().find(buildActivityFilter(req.query), {
        sort: { start_date: -1 },
        limit: req.query.limit ? Number(req.query.limit) : void 0
    }));
});

router.get('/activities/stats', async (req, res) => {
    const activities = await getActivityStore().find(buildActivityFilter(req.query), { sort: { start_date: -1 } });
    const stats = activities.reduce((accumulator, activity) => {
        accumulator.distance += Number(activity.distance || 0);
        accumulator.time += Number(activity.elapsed_time || 0);
        accumulator.count += 1;
        accumulator.elevation += Number(activity.total_elevation_gain || 0);
        accumulator.activityCounts[activity.type] = (accumulator.activityCounts[activity.type] || 0) + 1;
        return accumulator;
    }, { distance: 0, time: 0, count: 0, elevation: 0, activityCounts: {} });
    res.json(stats);
});

router.get('/activities/types', async (req, res) => {
    const activities = await getActivityStore().find(buildActivityFilter(req.query), { sort: { type: 1 } });
    res.json(Array.from(new Set(activities.map((activity) => activity.type).filter(Boolean))).sort());
});

router.get('/activities/:id', async (req, res) => {
    const activityId = Number(req.params.id);
    if (!activityId) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }

    const filter = { strava_id: activityId };
    if (req.query.user) {
        filter.user_slug = req.query.user;
    }

    let activity = await getActivityStore().findOne(filter);
    const shouldRefresh = isTruthy(req.query.refresh);
    const shouldHydrate = isTruthy(req.query.hydrate);

    if (!activity) {
        if (!req.query.user) {
            res.status(404).json({ error: 'Activity not found' });
            return;
        }
        const user = await getUserStore().findOne({ slug: req.query.user });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        activity = await fetchActivityDetail(user, activityId);
        res.json(activity);
        return;
    }

    if (shouldRefresh || (shouldHydrate && !activity.detail_fetched_at)) {
        const user = await getUserStore().findOne({ slug: activity.user_slug });
        if (user) {
            activity = await fetchActivityDetail(user, activityId);
        }
    }

    res.json(activity);
});

router.get('/activities/:id/streams', async (req, res) => {
    const activityId = Number(req.params.id);
    if (!activityId) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }

    const filter = { strava_id: activityId };
    if (req.query.user) {
        filter.user_slug = req.query.user;
    }

    let activity = await getActivityStore().findOne(filter);
    if (!activity) {
        res.status(404).json({ error: 'Activity not found' });
        return;
    }

    const hasCachedStream = Array.isArray(activity.stream_latlng)
        && activity.stream_latlng.length
        && Array.isArray(activity.stream_velocity_smooth)
        && activity.stream_velocity_smooth.length;

    if (hasCachedStream && !isTruthy(req.query.refresh)) {
        res.json(buildActivityStreamResponse(activity, true));
        return;
    }

    const user = await getUserStore().findOne({ slug: activity.user_slug });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    const streamActivity = await fetchActivityStreams(user, activityId);
    res.json(buildActivityStreamResponse(streamActivity, false));
});

module.exports = router;
