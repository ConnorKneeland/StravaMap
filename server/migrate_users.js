const dotenv = require('dotenv');
const { connectDb, isMongoConnected, wrapModel } = require('./db');
const getUserModel = require('./models/user');

dotenv.config();

const DEFAULT_USERS = [
    { display_name: 'Connor', slug: 'connor', client_id: 162238, client_secret: '526b6989b62616ce1416f27e0414866958666013', refresh_token: '23227cb9c49a632130451aa2206241479b6dd842', color: '#ff412e', default_lat: 43.0722, default_lng: -89.4008, num_pages: 10 },
    { display_name: 'Tim', slug: 'tim', client_id: 100558, client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refresh_token: 'fd40d09e3d95895eda12334f5a6254db341ac516', color: '#ff8000ff', default_lat: 44.4347, default_lng: -88.0679, num_pages: 30 },
    { display_name: 'Quinn', slug: 'quinn', client_id: 100558, client_secret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refresh_token: '93bfb1298cb4e356053a8116127327d78a607608', color: '#1648ebff', default_lat: 43.034, default_lng: -87.912, num_pages: 10 }
];

async function migrate() {
    await connectDb(process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGO_URI is required to migrate users into MongoDB.');
    }
    const store = wrapModel(getUserModel());
    for (const user of DEFAULT_USERS) {
        await store.upsertOne({ slug: user.slug }, user);
    }
    console.log('Users migrated.');
    process.exit(0);
}

migrate().catch((error) => {
    console.error(error);
    process.exit(1);
});
