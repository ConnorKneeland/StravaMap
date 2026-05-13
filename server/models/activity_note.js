const mongoose = require('mongoose');

const activityNoteSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    user_slug: { type: String, required: true, index: true },
    strava_id: { type: Number, required: true, index: true },
    elapsed_seconds: { type: Number, required: true, min: 0 },
    latlng: { type: [Number], default: void 0 },
    subject: { type: String, default: 'Untitled Note' },
    text: { type: String, required: true }
}, { timestamps: true });

activityNoteSchema.index({ user_slug: 1, strava_id: 1, elapsed_seconds: 1 });

module.exports = function getActivityNoteModel() {
    return mongoose.models.ActivityNote || mongoose.model('ActivityNote', activityNoteSchema);
};
