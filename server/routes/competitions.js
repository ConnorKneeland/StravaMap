const express = require('express');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getCompetitionModel = require('../models/competition');
const { getActivityStore } = require('../services/sync');

const router = express.Router();

function getCompetitionStore() {
    return isMongoConnected() ? wrapModel(getCompetitionModel()) : memoryStore.competitions;
}

async function buildLeaderboard(competition) {
    const filter = {
        user_slug: { $in: competition.participants || [] }
    };
    if (competition.activity_types && competition.activity_types.length) {
        filter.type = { $in: competition.activity_types };
    }
    if (competition.date_start || competition.date_end) {
        filter.start_date = {};
        if (competition.date_start) {
            filter.start_date.$gte = competition.date_start;
        }
        if (competition.date_end) {
            filter.start_date.$lte = competition.date_end;
        }
    }
    const activities = await getActivityStore().find(filter, { sort: { start_date: -1 } });
    const totals = {};
    activities.forEach((activity) => {
        const slug = activity.user_slug;
        if (!totals[slug]) {
            totals[slug] = 0;
        }
        if (competition.metric === 'time') {
            totals[slug] += Number(activity.elapsed_time || 0);
        } else if (competition.metric === 'count') {
            totals[slug] += 1;
        } else if (competition.metric === 'elevation') {
            totals[slug] += Number(activity.total_elevation_gain || 0);
        } else {
            totals[slug] += Number(activity.distance || 0);
        }
    });
    return Object.entries(totals).map(([slug, value]) => ({ slug, value })).sort((left, right) => right.value - left.value);
}

router.get('/competitions', async (req, res) => {
    res.json(await getCompetitionStore().find({}, { sort: { createdAt: -1 } }));
});

router.post('/competitions', async (req, res) => {
    const payload = Object.assign({ id: Date.now().toString() }, req.body || {});
    const competition = await getCompetitionStore().insertOne(payload);
    res.status(201).json(competition);
});

router.get('/competitions/:id', async (req, res) => {
    const competition = await getCompetitionStore().findOne({ id: req.params.id }) || await getCompetitionStore().findOne({ _id: req.params.id });
    if (!competition) {
        res.status(404).json({ error: 'Competition not found' });
        return;
    }
    res.json(competition);
});

router.get('/competitions/:id/leaderboard', async (req, res) => {
    const competition = await getCompetitionStore().findOne({ id: req.params.id }) || await getCompetitionStore().findOne({ _id: req.params.id });
    if (!competition) {
        res.status(404).json({ error: 'Competition not found' });
        return;
    }
    res.json(await buildLeaderboard(competition));
});

router.put('/competitions/:id', async (req, res) => {
    const competition = await getCompetitionStore().upsertOne({ id: req.params.id }, Object.assign({}, req.body || {}, { id: req.params.id }));
    res.json(competition);
});

router.delete('/competitions/:id', async (req, res) => {
    const removed = await getCompetitionStore().deleteOne({ id: req.params.id }) || await getCompetitionStore().deleteOne({ _id: req.params.id });
    res.json(removed || { deleted: false });
});

module.exports = router;
