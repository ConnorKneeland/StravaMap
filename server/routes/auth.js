const express = require('express');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');
const { toPublicUser, normalizeSlug } = require('../services/connection');

const router = express.Router();
const PUBLIC_USER_FIELDS = new Set([
    'display_name',
    'color',
    'default_lat',
    'default_lng',
    'num_pages',
    'profile_pic'
]);

function getUserStore() {
    return isMongoConnected() ? wrapModel(getUserModel()) : memoryStore.users;
}

function pickPublicUserFields(payload) {
    return Object.entries(payload || {}).reduce((result, entry) => {
        if (PUBLIC_USER_FIELDS.has(entry[0])) {
            result[entry[0]] = entry[1];
        }
        return result;
    }, {});
}

router.get('/users', async (req, res) => {
    const users = await getUserStore().find({}, { sort: { display_name: 1 } });
    res.json(users.map(toPublicUser));
});

router.get('/users/:slug', async (req, res) => {
    const slug = normalizeSlug(req.params.slug);
    const user = slug ? await getUserStore().findOne({ slug }) : null;
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(toPublicUser(user));
});

router.post('/users', async (req, res) => {
    const slug = normalizeSlug(req.body && req.body.slug);
    const payload = Object.assign(pickPublicUserFields(req.body), {
        slug,
        connection_status: 'not_connected',
        needs_reconnect: false,
        oauth_application: 'primary',
        migration_status: 'not_started'
    });
    if (!slug || !payload.display_name) {
        res.status(400).json({ error: 'A valid slug and display_name are required' });
        return;
    }
    const user = await getUserStore().insertOne(payload);
    res.status(201).json(toPublicUser(user));
});

router.put('/users/:slug', async (req, res) => {
    const slug = normalizeSlug(req.params.slug);
    if (!slug) {
        res.status(400).json({ error: 'Invalid user slug' });
        return;
    }
    const existing = await getUserStore().findOne({ slug });
    if (!existing) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    const payload = pickPublicUserFields(req.body);
    const user = await getUserStore().updateOne({ slug }, payload);
    res.json(toPublicUser(user));
});

module.exports = router;
