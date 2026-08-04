const mongoose = require('mongoose');
const Mixed = mongoose.Schema.Types.Mixed;

const webhookEventSchema = new mongoose.Schema({
    event_key: { type: String, required: true, unique: true, index: true },
    owner_id: { type: Number, required: true, index: true },
    object_id: { type: Number },
    object_type: { type: String, required: true },
    aspect_type: { type: String, required: true },
    payload: { type: Mixed },
    status: { type: String, default: 'pending', index: true },
    attempts: { type: Number, default: 0 },
    next_retry_at: { type: Date, default: null, index: true },
    last_error: { type: String },
    processed_at: { type: Date, default: null }
}, { timestamps: true });

module.exports = function getWebhookEventModel() {
    return mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);
};
