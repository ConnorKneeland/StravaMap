const mongoose = require('mongoose');
const Mixed = mongoose.Schema.Types.Mixed;

const intervalsActivityStreamSchema = new mongoose.Schema({
    schema_version: { type: Number, default: 1 },
    user_slug: { type: String, required: true, index: true },
    intervals_activity_id: { type: String, required: true },
    provider: { type: String, default: 'intervals_icu' },
    stream_data: { type: Mixed, required: true, default: {} },
    stream_keys: { type: [String], default: void 0 },
    stream_requested_keys: { type: [String], default: void 0 },
    stream_metadata: { type: Mixed },
    stream_resolution: { type: String },
    stream_series_type: { type: String },
    stream_fetched_at: { type: Date }
}, { timestamps: true, collection: 'intervals_activity_streams' });

intervalsActivityStreamSchema.index(
    { user_slug: 1, intervals_activity_id: 1 },
    { unique: true, name: 'intervals_activity_streams_user_slug_intervals_activity_id_unique' }
);

module.exports = function getIntervalsActivityStreamModel() {
    return mongoose.models.IntervalsActivityStream
        || mongoose.model('IntervalsActivityStream', intervalsActivityStreamSchema);
};
