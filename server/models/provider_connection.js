const mongoose = require('mongoose');

const providerConnectionSchema = new mongoose.Schema({
    connection_key: { type: String, required: true, unique: true, index: true },
    user_slug: { type: String, required: true, index: true },
    provider: { type: String, required: true, index: true },
    provider_athlete_id: { type: String, required: true },
    provider_athlete_name: { type: String },
    auth_type: { type: String, enum: ['oauth', 'api_key'], default: 'oauth', index: true },
    encrypted_access_token: { type: String, required: true },
    token_iv: { type: String, required: true },
    token_auth_tag: { type: String, required: true },
    granted_scopes: { type: [String], default: void 0 },
    connection_status: { type: String, default: 'connected', index: true },
    needs_reconnect: { type: Boolean, default: false, index: true },
    connected_at: { type: Date },
    last_sync: { type: Date },
    last_successful_sync_at: { type: Date },
    sync_status: { type: String, default: 'idle' },
    sync_progress: { type: mongoose.Schema.Types.Mixed },
    sync_error: { type: String },
    sync_retry_at: { type: Date },
    total_activities: { type: Number, default: 0 },
    backfill_complete: { type: Boolean, default: false }
}, { timestamps: true, collection: 'provider_connections' });

providerConnectionSchema.index({ user_slug: 1, provider: 1 }, { unique: true });
providerConnectionSchema.index({ provider: 1, provider_athlete_id: 1 }, { unique: true });

module.exports = function getProviderConnectionModel() {
    return mongoose.models.ProviderConnection || mongoose.model('ProviderConnection', providerConnectionSchema);
};
