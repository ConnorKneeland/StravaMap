const express = require('express');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');

const router = express.Router();

function getUserStore() {
    return isMongoConnected() ? wrapModel(getUserModel()) : memoryStore.users;
}

router.get('/users', async (req, res) => {
    res.json(await getUserStore().find({}, { sort: { display_name: 1 } }));
});

router.get('/users/:slug', async (req, res) => {
    const user = await getUserStore().findOne({ slug: req.params.slug });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(user);
});

router.post('/users', async (req, res) => {
    const payload = req.body || {};
    const user = await getUserStore().insertOne(payload);
    res.status(201).json(user);
});

router.put('/users/:slug', async (req, res) => {
    const payload = Object.assign({}, req.body || {}, { slug: req.params.slug });
    const user = await getUserStore().upsertOne({ slug: req.params.slug }, payload);
    res.json(user);
});

module.exports = router;
