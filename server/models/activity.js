const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    strava_id: { type: Number, required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.Mixed, required: true },
    user_slug: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, index: true },
    sport_type: { type: String },
    start_date: { type: Date, index: true },
    start_date_local: { type: String },
    timezone: { type: String },
    distance: { type: Number, default: 0 },
    elapsed_time: { type: Number, default: 0 },
    moving_time: { type: Number, default: 0 },
    average_speed: { type: Number, default: 0 },
    max_speed: { type: Number, default: 0 },
    average_heartrate: { type: Number },
    max_heartrate: { type: Number },
    elev_high: { type: Number },
    elev_low: { type: Number },
    total_elevation_gain: { type: Number, default: 0 },
    average_cadence: { type: Number },
    average_watts: { type: Number },
    kilojoules: { type: Number },
    location_city: { type: String },
    location_state: { type: String },
    location_country: { type: String },
    start_latlng: { type: [Number], default: void 0 },
    end_latlng: { type: [Number], default: void 0 },
    summary_polyline: { type: String },
    detail_fetched_at: { type: Date },
    stream_resolution: { type: String },
    stream_series_type: { type: String },
    stream_latlng: { type: [[Number]], default: void 0 },
    stream_velocity_smooth: { type: [Number], default: void 0 },
    stream_time: { type: [Number], default: void 0 },
    stream_fetched_at: { type: Date }
}, { timestamps: true });

activitySchema.index({ user_id: 1, type: 1 });
activitySchema.index({ user_id: 1, start_date: 1 });
activitySchema.index({ type: 1, start_date: 1 });

module.exports = function getActivityModel() {
    return mongoose.models.Activity || mongoose.model('Activity', activitySchema);
};
