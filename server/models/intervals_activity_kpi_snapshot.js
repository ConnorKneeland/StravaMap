const mongoose = require('mongoose');
const Mixed = mongoose.Schema.Types.Mixed;

const schema = new mongoose.Schema({
    schema_version: { type: Number, default: 1 },
    id: { type: String, required: true, unique: true },
    user_slug: { type: String, required: true, index: true },
    category_key: { type: String, required: true },
    category_label: { type: String, required: true },
    count: { type: Number, default: 0 },
    distance_meters: { type: Number, default: 0 },
    moving_time_seconds: { type: Number, default: 0 },
    elapsed_time_seconds: { type: Number, default: 0 },
    elevation_gain_meters: { type: Number, default: 0 },
    metrics: { type: Mixed, default: {} },
    latest_activity_id: { type: String },
    latest_activity_start_date: { type: Date },
    recomputed_at: { type: Date }
}, { timestamps: true, collection: 'intervals_activity_kpi_snapshots' });

schema.index({ user_slug: 1, category_key: 1 }, { unique: true });

module.exports = function getIntervalsActivityKpiSnapshotModel() {
    return mongoose.models.IntervalsActivityKpiSnapshot
        || mongoose.model('IntervalsActivityKpiSnapshot', schema);
};
