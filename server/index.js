const path = require('path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDb, isMongoConnected, memoryStore } = require('./db');
const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const competitionRoutes = require('./routes/competitions');

dotenv.config();

const DEFAULT_USERS = [
    {
        display_name: 'Connor',
        slug: 'connor',
        client_id: 162238,
        client_secret: '526b6989b62616ce1416f27e0414866958666013',
        refresh_token: '23227cb9c49a632130451aa2206241479b6dd842',
        color: '#ff412e',
        default_lat: 43.0722,
        default_lng: -89.4008,
        num_pages: 10
    },
    {
        display_name: 'Tim',
        slug: 'tim',
        client_id: 100558,
        client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910',
        refresh_token: 'fd40d09e3d95895eda12334f5a6254db341ac516',
        color: '#ff8000ff',
        default_lat: 44.4347,
        default_lng: -88.0679,
        num_pages: 30
    },
    {
        display_name: 'Quinn',
        slug: 'quinn',
        client_id: 100558,
        client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910',
        refresh_token: '93bfb1298cb4e356053a8116127327d78a607608',
        color: '#1648ebff',
        default_lat: 43.034,
        default_lng: -87.912,
        num_pages: 10
    }
];

async function seedMemoryUsers() {
    for (const user of DEFAULT_USERS) {
        await memoryStore.users.upsertOne({ slug: user.slug }, user);
    }
}

async function start() {
    await connectDb(process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        await seedMemoryUsers();
    }

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use('/api', authRoutes);
    app.use('/api', activityRoutes);
    app.use('/api', competitionRoutes);
    app.use(express.static(path.resolve(__dirname, '..')));

    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}

start().catch((error) => {
    console.error(error);
    process.exit(1);
});
