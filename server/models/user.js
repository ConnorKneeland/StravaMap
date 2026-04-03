const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    strava_id: { type: Number, unique: true, sparse: true },
    display_name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    client_id: { type: Number, required: true },
    client_secret: { type: String, required: true },
    access_token: { type: String },
    refresh_token: { type: String, required: true },
    token_expires: { type: Date },
    color: { type: String },
    default_lat: { type: Number },
    default_lng: { type: Number },
    last_sync: { type: Date },
    total_activities: { type: Number, default: 0 },
    num_pages: { type: Number, default: 1 },
    profile_pic: { type: String }
}, { timestamps: true });

module.exports = function getUserModel() {
    return mongoose.models.User || mongoose.model('User', userSchema);
};
