const mongoose = require('mongoose');

const oauthStateSchema = new mongoose.Schema({
    state_hash: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, index: true },
    provider: { type: String, default: 'strava', index: true },
    nonce: { type: String, required: true, unique: true },
    expires_at: { type: Date, required: true },
    return_url: { type: String },
    claimed_at: { type: Date, default: null },
    consumed_at: { type: Date, default: null }
}, { timestamps: true });

oauthStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 86400 });

module.exports = function getOAuthStateModel() {
    return mongoose.models.OAuthState || mongoose.model('OAuthState', oauthStateSchema);
};
