const mongoose = require('mongoose');
const Mixed = mongoose.Schema.Types.Mixed;

const userSchema = new mongoose.Schema({
    strava_id: { type: Number, unique: true, sparse: true },
    display_name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    client_id: { type: Number },
    client_secret: { type: String },
    access_token: { type: String },
    refresh_token: { type: String },
    token_expires: { type: Date },
    granted_scopes: { type: [String], default: void 0 },
    connection_status: { type: String, default: 'not_connected', index: true },
    connected_at: { type: Date },
    needs_reconnect: { type: Boolean, default: false, index: true },
    oauth_application: { type: String, default: 'legacy' },
    migration_status: { type: String, default: 'legacy' },
    color: { type: String },
    default_lat: { type: Number },
    default_lng: { type: Number },
    last_sync: { type: Date },
    last_successful_sync_at: { type: Date },
    sync_status: { type: String, default: 'idle' },
    sync_progress: { type: Mixed },
    sync_error: { type: String },
    sync_retry_at: { type: Date },
    sync_backoff_attempts: { type: Number, default: 0 },
    backfill_complete: { type: Boolean, default: false },
    total_activities: { type: Number, default: 0 },
    num_pages: { type: Number, default: 1 },
    profile_pic: { type: String }
}, { timestamps: true });

module.exports = function getUserModel() {
    return mongoose.models.User || mongoose.model('User', userSchema);
};
