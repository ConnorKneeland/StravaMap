const crypto = require('crypto');
const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getWebhookEventModel = require('../models/webhook_event');
const { getUserStore, getActivityStore, syncUserActivities } = require('./sync');

const RETRY_WORKER_INTERVAL_MS = 60 * 1000;
const MAX_WEBHOOK_ATTEMPTS = 10;
let workerTimer = null;

function getWebhookEventStore() {
    return isMongoConnected() ? wrapModel(getWebhookEventModel()) : memoryStore.webhookEvents;
}

function createEventKey(payload) {
    const stablePayload = JSON.stringify({
        owner_id: Number(payload.owner_id),
        object_id: Number(payload.object_id),
        object_type: payload.object_type,
        aspect_type: payload.aspect_type,
        event_time: Number(payload.event_time || 0),
        updates: payload.updates || null
    });
    return crypto.createHash('sha256').update(stablePayload).digest('hex');
}

function getRetryAt(attempts) {
    const delayMs = Math.min(60 * 60 * 1000, Math.pow(2, Math.min(attempts, 10)) * 30000);
    return new Date(Date.now() + delayMs);
}

async function queueWebhookEvent(payload) {
    const event = {
        event_key: createEventKey(payload),
        owner_id: Number(payload.owner_id),
        object_id: Number(payload.object_id),
        object_type: String(payload.object_type || ''),
        aspect_type: String(payload.aspect_type || ''),
        payload,
        status: 'pending',
        attempts: 0,
        next_retry_at: new Date(),
        last_error: '',
        processed_at: null
    };
    const store = getWebhookEventStore();
    const existing = await store.findOne({ event_key: event.event_key });
    return existing || store.insertOne(event);
}

async function processWebhookEvent(event) {
    const eventStore = getWebhookEventStore();
    const user = await getUserStore().findOne({ strava_id: Number(event.owner_id) });
    if (!user) {
        return eventStore.updateOne({ event_key: event.event_key }, {
            status: 'ignored',
            last_error: 'No slug is bound to this Strava athlete',
            processed_at: new Date()
        });
    }
    try {
        if (event.object_type !== 'activity') {
            return eventStore.updateOne({ event_key: event.event_key }, {
                status: 'ignored',
                last_error: 'Only activity events are synchronized',
                processed_at: new Date()
            });
        }
        if (event.aspect_type === 'delete') {
            await getActivityStore().updateOne({
                strava_id: Number(event.object_id),
                user_slug: user.slug
            }, {
                upstream_deleted: true,
                upstream_deleted_at: new Date(Number(event.payload && event.payload.event_time || 0) * 1000 || Date.now()),
                upstream_delete_source: 'strava_webhook'
            });
        } else if (event.aspect_type === 'create' || event.aspect_type === 'update') {
            await syncUserActivities(user);
        }
        return eventStore.updateOne({ event_key: event.event_key }, {
            status: 'completed',
            attempts: Number(event.attempts || 0) + 1,
            next_retry_at: null,
            last_error: '',
            processed_at: new Date()
        });
    } catch (error) {
        const attempts = Number(event.attempts || 0) + 1;
        return eventStore.updateOne({ event_key: event.event_key }, {
            status: attempts >= MAX_WEBHOOK_ATTEMPTS ? 'failed' : 'pending',
            attempts,
            next_retry_at: attempts >= MAX_WEBHOOK_ATTEMPTS ? null : getRetryAt(attempts),
            last_error: error && error.message ? error.message : 'Unknown webhook sync error'
        });
    }
}

async function processPendingWebhookEvents() {
    const events = await getWebhookEventStore().find({
        status: 'pending',
        next_retry_at: { $lte: new Date() }
    }, { sort: { next_retry_at: 1 }, limit: 20 });
    for (const event of events) {
        await processWebhookEvent(event);
    }
    return events.length;
}

function startWebhookRetryWorker() {
    if (workerTimer) {
        return workerTimer;
    }
    workerTimer = setInterval(() => {
        processPendingWebhookEvents().catch((error) => {
            console.warn('[Strava Webhook Retry Worker]', error && error.message ? error.message : error);
        });
    }, RETRY_WORKER_INTERVAL_MS);
    if (typeof workerTimer.unref === 'function') {
        workerTimer.unref();
    }
    setImmediate(() => {
        processPendingWebhookEvents().catch(() => {});
    });
    return workerTimer;
}

module.exports = {
    queueWebhookEvent,
    processWebhookEvent,
    processPendingWebhookEvents,
    startWebhookRetryWorker,
    getWebhookEventStore
};
