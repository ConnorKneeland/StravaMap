const crypto = require('crypto');
const express = require('express');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getActivityCollectionModel = require('../models/activity_collection');
const getActivityNoteModel = require('../models/activity_note');

const router = express.Router();

function getCollectionStore() {
    return isMongoConnected() ? wrapModel(getActivityCollectionModel()) : memoryStore.collections;
}

function getNoteStore() {
    return isMongoConnected() ? wrapModel(getActivityNoteModel()) : memoryStore.activityNotes;
}

function createToken(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function cleanString(value) {
    return String(value || '').trim();
}

function normalizeSlug(value) {
    return cleanString(value).toLowerCase();
}

function normalizeActivityIds(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)));
}

function hasInvalidActivityIds(value) {
    return Array.isArray(value) && value.some((item) => {
        const numeric = Number(item);
        return !Number.isFinite(numeric) || numeric <= 0;
    });
}

function normalizeLatLng(value) {
    if (!Array.isArray(value) || value.length !== 2) {
        return undefined;
    }
    const latlng = value.map((item) => Number(item));
    if (latlng.some((item) => !Number.isFinite(item))) {
        return undefined;
    }
    return latlng;
}

function normalizeCollection(collection) {
    if (!collection) {
        return null;
    }
    return Object.assign({}, collection, {
        activity_ids: normalizeActivityIds(collection.activity_ids)
    });
}

function normalizeNote(note) {
    if (!note) {
        return null;
    }
    const text = cleanString(note.text || note.body);
    return Object.assign({}, note, {
        strava_id: Number(note.strava_id),
        elapsed_seconds: Number(note.elapsed_seconds || 0),
        subject: cleanString(note.subject) || 'Untitled Note',
        text: text,
        body: text
    });
}

function isObjectIdLike(value) {
    return /^[0-9a-fA-F]{24}$/.test(String(value || ''));
}

async function findCollection(identifier) {
    const store = getCollectionStore();
    const byId = await store.findOne({ id: identifier });
    if (byId) {
        return normalizeCollection(byId);
    }
    if (isObjectIdLike(identifier)) {
        const byMongoId = await store.findOne({ _id: identifier });
        if (byMongoId) {
            return normalizeCollection(byMongoId);
        }
    }
    return normalizeCollection(await store.findOne({ share_token: identifier }));
}

function validateCollectionPayload(req, res) {
    const payload = req.body || {};
    const name = cleanString(payload.name);
    if (!name) {
        res.status(400).json({ error: 'Collection name is required' });
        return null;
    }
    if (hasInvalidActivityIds(payload.activity_ids)) {
        res.status(400).json({ error: 'activity_ids must contain only positive numeric ids' });
        return null;
    }
    return {
        name: name,
        description: cleanString(payload.description),
        activity_ids: normalizeActivityIds(payload.activity_ids)
    };
}

router.get('/users/:slug/collections', async (req, res) => {
    const ownerUserSlug = normalizeSlug(req.params.slug);
    if (!ownerUserSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    const collections = await getCollectionStore().find({ owner_user_slug: ownerUserSlug }, { sort: { updatedAt: -1 } });
    res.json(collections.map(normalizeCollection));
});

router.post('/users/:slug/collections', async (req, res) => {
    const ownerUserSlug = normalizeSlug(req.params.slug);
    const payload = validateCollectionPayload(req, res);
    if (!ownerUserSlug || !payload) {
        if (!ownerUserSlug) {
            res.status(400).json({ error: 'User slug is required' });
        }
        return;
    }

    const collection = await getCollectionStore().insertOne(Object.assign({}, payload, {
        id: cleanString(req.body && req.body.id) || createToken('collection'),
        share_token: cleanString(req.body && req.body.share_token) || createToken('share'),
        owner_user_slug: ownerUserSlug
    }));
    res.status(201).json(normalizeCollection(collection));
});

router.get('/collections/share/:shareToken', async (req, res) => {
    const collection = normalizeCollection(await getCollectionStore().findOne({ share_token: req.params.shareToken }));
    if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    res.json(collection);
});

router.get('/collections/:id', async (req, res) => {
    const collection = await findCollection(req.params.id);
    if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    res.json(collection);
});

router.patch('/collections/:id', async (req, res) => {
    const existing = await findCollection(req.params.id);
    if (!existing) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    const updates = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'name')) {
        updates.name = cleanString(req.body.name);
        if (!updates.name) {
            res.status(400).json({ error: 'Collection name is required' });
            return;
        }
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'description')) {
        updates.description = cleanString(req.body.description);
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'activity_ids')) {
        if (hasInvalidActivityIds(req.body.activity_ids)) {
            res.status(400).json({ error: 'activity_ids must contain only positive numeric ids' });
            return;
        }
        updates.activity_ids = normalizeActivityIds(req.body.activity_ids);
    }
    const collection = await getCollectionStore().updateOne({ id: existing.id }, updates);
    res.json(normalizeCollection(collection));
});

router.delete('/collections/:id', async (req, res) => {
    const existing = await findCollection(req.params.id);
    if (!existing) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    const removed = await getCollectionStore().deleteOne({ id: existing.id });
    res.json(normalizeCollection(removed) || { deleted: false });
});

router.post('/collections/:id/activities/:stravaId', async (req, res) => {
    const existing = await findCollection(req.params.id);
    const stravaId = Number(req.params.stravaId);
    if (!existing) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    if (!Number.isFinite(stravaId) || stravaId <= 0) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const activityIds = normalizeActivityIds((existing.activity_ids || []).concat([stravaId]));
    const collection = await getCollectionStore().updateOne({ id: existing.id }, { activity_ids: activityIds });
    res.json(normalizeCollection(collection));
});

router.delete('/collections/:id/activities/:stravaId', async (req, res) => {
    const existing = await findCollection(req.params.id);
    const stravaId = Number(req.params.stravaId);
    if (!existing) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    if (!Number.isFinite(stravaId) || stravaId <= 0) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const activityIds = normalizeActivityIds(existing.activity_ids).filter((activityId) => activityId !== stravaId);
    const collection = await getCollectionStore().updateOne({ id: existing.id }, { activity_ids: activityIds });
    res.json(normalizeCollection(collection));
});

router.get('/activities/:id/notes', async (req, res) => {
    const stravaId = Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user);
    if (!Number.isFinite(stravaId) || stravaId <= 0) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    if (!userSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    const notes = await getNoteStore().find({ user_slug: userSlug, strava_id: stravaId }, { sort: { elapsed_seconds: 1 } });
    res.json(notes.map(normalizeNote));
});

router.post('/activities/:id/notes', async (req, res) => {
    const stravaId = Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user || (req.body && req.body.user_slug));
    const elapsedSeconds = Number(req.body && req.body.elapsed_seconds);
    const subject = cleanString(req.body && (req.body.subject || req.body.title)) || 'Untitled Note';
    const text = cleanString(req.body && (req.body.text || req.body.body));
    const latlng = normalizeLatLng(req.body && req.body.latlng);
    if (!Number.isFinite(stravaId) || stravaId <= 0) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    if (!userSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
        res.status(400).json({ error: 'elapsed_seconds must be a non-negative number' });
        return;
    }
    if (!text) {
        res.status(400).json({ error: 'Note text is required' });
        return;
    }

    const note = await getNoteStore().insertOne({
        id: cleanString(req.body && req.body.id) || createToken('note'),
        user_slug: userSlug,
        strava_id: stravaId,
        elapsed_seconds: elapsedSeconds,
        latlng: latlng,
        subject: subject,
        text: text
    });
    res.status(201).json(normalizeNote(note));
});

router.patch('/activities/:id/notes/:noteId', async (req, res) => {
    const stravaId = Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user || (req.body && req.body.user_slug));
    if (!Number.isFinite(stravaId) || stravaId <= 0) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const filter = { id: req.params.noteId, strava_id: stravaId };
    if (userSlug) {
        filter.user_slug = userSlug;
    }
    const existing = await getNoteStore().findOne(filter);
    if (!existing) {
        res.status(404).json({ error: 'Note not found' });
        return;
    }
    const updates = {};
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'elapsed_seconds')) {
        const elapsedSeconds = Number(req.body.elapsed_seconds);
        if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
            res.status(400).json({ error: 'elapsed_seconds must be a non-negative number' });
            return;
        }
        updates.elapsed_seconds = elapsedSeconds;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'latlng')) {
        updates.latlng = normalizeLatLng(req.body.latlng);
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'subject')) {
        updates.subject = cleanString(req.body.subject);
        if (!updates.subject) {
            res.status(400).json({ error: 'Note subject is required' });
            return;
        }
    }
    if (req.body && (Object.prototype.hasOwnProperty.call(req.body, 'text') || Object.prototype.hasOwnProperty.call(req.body, 'body'))) {
        updates.text = cleanString(req.body.text || req.body.body);
        if (!updates.text) {
            res.status(400).json({ error: 'Note text is required' });
            return;
        }
    }
    const note = await getNoteStore().updateOne({ id: existing.id }, updates);
    res.json(normalizeNote(note));
});

router.delete('/activities/:id/notes/:noteId', async (req, res) => {
    const stravaId = Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user);
    if (!Number.isFinite(stravaId) || stravaId <= 0) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const filter = { id: req.params.noteId, strava_id: stravaId };
    if (userSlug) {
        filter.user_slug = userSlug;
    }
    const removed = await getNoteStore().deleteOne(filter);
    if (!removed) {
        res.status(404).json({ error: 'Note not found' });
        return;
    }
    res.json(normalizeNote(removed));
});

module.exports = router;
