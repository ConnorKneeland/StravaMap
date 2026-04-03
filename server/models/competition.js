const mongoose = require('mongoose');

const competitionSchema = new mongoose.Schema({
    id: { type: String, index: true },
    name: { type: String, required: true },
    description: { type: String },
    created_by: { type: String },
    participants: { type: [String], default: [] },
    activity_types: { type: [String], default: [] },
    date_start: { type: Date, required: true },
    date_end: { type: Date, required: true },
    metric: { type: String, enum: ['distance', 'time', 'count', 'elevation'], required: true },
    status: { type: String, enum: ['active', 'completed', 'archived'], default: 'active' }
}, { timestamps: true });

module.exports = function getCompetitionModel() {
    return mongoose.models.Competition || mongoose.model('Competition', competitionSchema);
};
