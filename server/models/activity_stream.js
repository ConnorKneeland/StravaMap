const mongoose = require('mongoose');
const Mixed = mongoose.Schema.Types.Mixed;

const activityStreamSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 1 },
    user_slug: { type: String, required: true, index: true },
    strava_id: { type: Number, required: true },
    stream_data: { type: Mixed, required: true, default: {} },
    stream_keys: { type: [String], default: void 0 },
    stream_requested_keys: { type: [String], default: void 0 },
    stream_metadata: { type: Mixed },
    stream_resolution: { type: String },
    stream_series_type: { type: String },
    stream_fetched_at: { type: Date }
}, { timestamps: true, collection: 'activity_streams' });

activityStreamSchema.index(
    { user_slug: 1, strava_id: 1 },
    { unique: true, name: 'activity_streams_user_slug_strava_id_unique' }
);

module.exports = function getActivityStreamModel() {
    return mongoose.models.ActivityStream || mongoose.model('ActivityStream', activityStreamSchema);
};
