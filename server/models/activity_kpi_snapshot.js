const mongoose = require('mongoose');

const activityKpiSnapshotSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    user_slug: { type: String, required: true, index: true },
    category_key: { type: String, required: true },
    category_label: { type: String, required: true },
    count: { type: Number, default: 0 },
    distance_meters: { type: Number, default: 0 },
    moving_time_seconds: { type: Number, default: 0 },
    elapsed_time_seconds: { type: Number, default: 0 },
    elevation_gain_meters: { type: Number, default: 0 },
    latest_activity_id: { type: Number },
    latest_activity_start_date: { type: Date },
    recomputed_at: { type: Date }
}, { timestamps: true });

activityKpiSnapshotSchema.index({ user_slug: 1, category_key: 1 }, { unique: true });

module.exports = function getActivityKpiSnapshotModel() {
    return mongoose.models.ActivityKpiSnapshot || mongoose.model('ActivityKpiSnapshot', activityKpiSnapshotSchema);
};
