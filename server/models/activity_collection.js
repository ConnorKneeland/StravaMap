const mongoose = require('mongoose');

const activityCollectionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    share_token: { type: String, required: true, unique: true, index: true },
    owner_user_slug: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    activity_ids: { type: [Number], default: [] }
}, { timestamps: true });

activityCollectionSchema.index({ owner_user_slug: 1, updatedAt: -1 });

module.exports = function getActivityCollectionModel() {
    return mongoose.models.ActivityCollection || mongoose.model('ActivityCollection', activityCollectionSchema);
};
