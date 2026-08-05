const crypto = require('crypto');
const express = require('express');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getActivityCollectionModel = require('../models/activity_collection');
const getActivityNoteModel = require('../models/activity_note');
const { verifyOwnerToken } = require('../services/intervals_auth');

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

function normalizeSource(value) {
    return cleanString(value).toLowerCase() === 'intervals_icu' ? 'intervals_icu' : 'strava';
}

function getBearerToken(req) {
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
}

function requireSourceOwner(req, res, source, slug) {
    if (normalizeSource(source) !== 'intervals_icu') {
        return true;
    }
    try {
        verifyOwnerToken(getBearerToken(req), slug);
        return true;
    } catch (error) {
        res.status(error.statusCode || 401).json({ error: error.message, code: error.code || 'owner_auth_required' });
        return false;
    }
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

function normalizeActivityRefs(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value.map(cleanString).filter((item) => item && item.length <= 128)));
}

function hasInvalidActivityRefs(value) {
    return Array.isArray(value) && value.some((item) => !cleanString(item) || cleanString(item).length > 128);
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
    const source = normalizeSource(collection.source);
    const activityRefs = source === 'intervals_icu'
        ? normalizeActivityRefs(collection.activity_refs && collection.activity_refs.length
            ? collection.activity_refs : collection.activity_ids)
        : normalizeActivityIds(collection.activity_ids);
    return Object.assign({}, collection, {
        source,
        activity_refs: source === 'intervals_icu' ? activityRefs : normalizeActivityRefs(collection.activity_refs),
        activity_ids: activityRefs
    });
}

function normalizeNote(note) {
    if (!note) {
        return null;
    }
    const text = cleanString(note.text || note.body);
    const source = normalizeSource(note.source);
    return Object.assign({}, note, {
        source,
        activity_ref: source === 'intervals_icu' ? cleanString(note.activity_ref) : String(note.strava_id),
        strava_id: source === 'strava' ? Number(note.strava_id) : undefined,
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
    const source = normalizeSource(payload.source || req.query.source);
    const name = cleanString(payload.name);
    if (!name) {
        res.status(400).json({ error: 'Collection name is required' });
        return null;
    }
    const rawActivityIds = payload.activity_refs || payload.activity_ids;
    if (source === 'intervals_icu' ? hasInvalidActivityRefs(rawActivityIds) : hasInvalidActivityIds(rawActivityIds)) {
        res.status(400).json({ error: source === 'intervals_icu'
            ? 'activity ids must contain valid Intervals.icu string ids'
            : 'activity_ids must contain only positive numeric ids' });
        return null;
    }
    return {
        source,
        name: name,
        description: cleanString(payload.description),
        activity_ids: source === 'strava' ? normalizeActivityIds(rawActivityIds) : [],
        activity_refs: source === 'intervals_icu' ? normalizeActivityRefs(rawActivityIds) : []
    };
}

router.get('/users/:slug/collections', async (req, res) => {
    const ownerUserSlug = normalizeSlug(req.params.slug);
    if (!ownerUserSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    const requestedSource = normalizeSource(req.query.source);
    const collections = await getCollectionStore().find({ owner_user_slug: ownerUserSlug }, { sort: { updatedAt: -1 } });
    res.json(collections.map(normalizeCollection).filter((collection) => collection.source === requestedSource));
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
    if (!requireSourceOwner(req, res, payload.source, ownerUserSlug)) {
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
    if (!requireSourceOwner(req, res, existing.source, existing.owner_user_slug)) {
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
    if (req.body && (Object.prototype.hasOwnProperty.call(req.body, 'activity_ids')
        || Object.prototype.hasOwnProperty.call(req.body, 'activity_refs'))) {
        const values = req.body.activity_refs || req.body.activity_ids;
        if (existing.source === 'intervals_icu' ? hasInvalidActivityRefs(values) : hasInvalidActivityIds(values)) {
            res.status(400).json({ error: 'Invalid activity ids' });
            return;
        }
        if (existing.source === 'intervals_icu') {
            updates.activity_refs = normalizeActivityRefs(values);
        } else {
            updates.activity_ids = normalizeActivityIds(values);
        }
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
    if (!requireSourceOwner(req, res, existing.source, existing.owner_user_slug)) {
        return;
    }
    const removed = await getCollectionStore().deleteOne({ id: existing.id });
    res.json(normalizeCollection(removed) || { deleted: false });
});

router.post('/collections/:id/activities/:activityId', async (req, res) => {
    const existing = await findCollection(req.params.id);
    if (!existing) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    if (!requireSourceOwner(req, res, existing.source, existing.owner_user_slug)) {
        return;
    }
    const activityRef = existing.source === 'intervals_icu'
        ? cleanString(req.params.activityId)
        : Number(req.params.activityId);
    if (existing.source === 'intervals_icu' ? !activityRef : (!Number.isFinite(activityRef) || activityRef <= 0)) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const updates = existing.source === 'intervals_icu'
        ? { activity_refs: normalizeActivityRefs((existing.activity_refs || existing.activity_ids || []).concat([activityRef])) }
        : { activity_ids: normalizeActivityIds((existing.activity_ids || []).concat([activityRef])) };
    const collection = await getCollectionStore().updateOne({ id: existing.id }, updates);
    res.json(normalizeCollection(collection));
});

router.delete('/collections/:id/activities/:activityId', async (req, res) => {
    const existing = await findCollection(req.params.id);
    if (!existing) {
        res.status(404).json({ error: 'Collection not found' });
        return;
    }
    if (!requireSourceOwner(req, res, existing.source, existing.owner_user_slug)) {
        return;
    }
    const activityRef = existing.source === 'intervals_icu'
        ? cleanString(req.params.activityId)
        : Number(req.params.activityId);
    if (existing.source === 'intervals_icu' ? !activityRef : (!Number.isFinite(activityRef) || activityRef <= 0)) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    const updates = existing.source === 'intervals_icu'
        ? { activity_refs: normalizeActivityRefs(existing.activity_refs || existing.activity_ids).filter((id) => id !== activityRef) }
        : { activity_ids: normalizeActivityIds(existing.activity_ids).filter((id) => id !== activityRef) };
    const collection = await getCollectionStore().updateOne({ id: existing.id }, updates);
    res.json(normalizeCollection(collection));
});

router.get('/activities/:id/notes', async (req, res) => {
    const source = normalizeSource(req.query.source);
    const activityRef = source === 'intervals_icu' ? cleanString(req.params.id) : Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user);
    if (source === 'intervals_icu' ? !activityRef : (!Number.isFinite(activityRef) || activityRef <= 0)) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    if (!userSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    let notes;
    if (source === 'intervals_icu') {
        notes = await getNoteStore().find({ user_slug: userSlug, source, activity_ref: activityRef }, { sort: { elapsed_seconds: 1 } });
    } else {
        notes = await getNoteStore().find({ user_slug: userSlug, strava_id: activityRef }, { sort: { elapsed_seconds: 1 } });
        notes = notes.filter((note) => normalizeSource(note.source) === 'strava');
    }
    res.json(notes.map(normalizeNote));
});

router.post('/activities/:id/notes', async (req, res) => {
    const source = normalizeSource(req.query.source || (req.body && req.body.source));
    const activityRef = source === 'intervals_icu' ? cleanString(req.params.id) : Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user || (req.body && req.body.user_slug));
    const elapsedSeconds = Number(req.body && req.body.elapsed_seconds);
    const subject = cleanString(req.body && (req.body.subject || req.body.title)) || 'Untitled Note';
    const text = cleanString(req.body && (req.body.text || req.body.body));
    const latlng = normalizeLatLng(req.body && req.body.latlng);
    if (source === 'intervals_icu' ? !activityRef : (!Number.isFinite(activityRef) || activityRef <= 0)) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    if (!userSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    if (!requireSourceOwner(req, res, source, userSlug)) {
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
        source,
        activity_ref: String(activityRef),
        strava_id: source === 'strava' ? activityRef : undefined,
        elapsed_seconds: elapsedSeconds,
        latlng: latlng,
        subject: subject,
        text: text
    });
    res.status(201).json(normalizeNote(note));
});

router.patch('/activities/:id/notes/:noteId', async (req, res) => {
    const source = normalizeSource(req.query.source || (req.body && req.body.source));
    const activityRef = source === 'intervals_icu' ? cleanString(req.params.id) : Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user || (req.body && req.body.user_slug));
    if (source === 'intervals_icu' ? !activityRef : (!Number.isFinite(activityRef) || activityRef <= 0)) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    if (source === 'intervals_icu' && !userSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    if (!requireSourceOwner(req, res, source, userSlug)) {
        return;
    }
    const filter = source === 'intervals_icu'
        ? { id: req.params.noteId, source, activity_ref: activityRef }
        : { id: req.params.noteId, strava_id: activityRef };
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
    const source = normalizeSource(req.query.source);
    const activityRef = source === 'intervals_icu' ? cleanString(req.params.id) : Number(req.params.id);
    const userSlug = normalizeSlug(req.query.user);
    if (source === 'intervals_icu' ? !activityRef : (!Number.isFinite(activityRef) || activityRef <= 0)) {
        res.status(400).json({ error: 'Invalid activity id' });
        return;
    }
    if (source === 'intervals_icu' && !userSlug) {
        res.status(400).json({ error: 'User slug is required' });
        return;
    }
    if (!requireSourceOwner(req, res, source, userSlug)) {
        return;
    }
    const filter = source === 'intervals_icu'
        ? { id: req.params.noteId, source, activity_ref: activityRef }
        : { id: req.params.noteId, strava_id: activityRef };
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
