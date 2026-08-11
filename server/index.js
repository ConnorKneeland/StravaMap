const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDb, isMongoConnected, memoryStore } = require('./db');
const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const competitionRoutes = require('./routes/competitions');
const collectionRoutes = require('./routes/collections');
const stravaRoutes = require('./routes/strava');
const intervalsRoutes = require('./routes/intervals');
const { router: widgetRoutes } = require('./routes/widget');
const { getAllFrontendUsers } = require('./frontend_user_configs');
const { getConfigurationStatus } = require('./config/strava');
const { getIntervalsConfigurationStatus } = require('./config/intervals');
const { startWebhookRetryWorker } = require('./services/webhook');

dotenv.config();

async function seedMemoryUsers() {
    for (const user of getAllFrontendUsers()) {
        await memoryStore.users.upsertOne({ slug: user.slug }, user);
    }
}

async function createApp() {
    await connectDb(process.env.MONGODB_URI || process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        await seedMemoryUsers();
    }

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            storage: isMongoConnected() ? 'MongoDB' : 'memory',
            mongoConnected: isMongoConnected(),
            configuration: getConfigurationStatus(),
            intervals: getIntervalsConfigurationStatus()
        });
    });
    app.use('/api', intervalsRoutes);
    app.use('/api', widgetRoutes);
    app.use('/api', stravaRoutes);
    app.use('/api', authRoutes);
    app.use('/api', activityRoutes);
    app.use('/api', competitionRoutes);
    app.use('/api', collectionRoutes);
    app.get('/icu_map.html', (req, res) => {
        res.sendFile(path.resolve(__dirname, '..', 'strava_user.html'));
    });
    app.use(express.static(path.resolve(__dirname, '..')));

    return app;
}

async function start() {
    const app = await createApp();
    startWebhookRetryWorker();

    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => {
        const storage = isMongoConnected() ? 'MongoDB' : 'memory';
        console.log(`Server listening on port ${port} using ${storage}`);
        if (!isMongoConnected()) {
            console.warn('MONGO_URI is missing or MongoDB is unavailable; persistent activity data cannot be loaded.');
        }
    });
}

if (require.main === module) {
    start().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { createApp, start };
