const express = require('express');
const { syncUserActivities, getUserStore, getActivityStore } = require('../services/sync');

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

router.post('/sync/:slug', async (req, res) => {
    const user = await getUserStore().findOne({ slug: req.params.slug });
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

module.exports = router;
