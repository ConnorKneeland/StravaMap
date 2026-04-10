const dotenv = require('dotenv');
const { connectDb, isMongoConnected, wrapModel } = require('./db');
const getUserModel = require('./models/user');
const { getAllFrontendUsers } = require('./frontend_user_configs');

dotenv.config();

async function migrate() {
    await connectDb(process.env.MONGO_URI || '');
    if (!isMongoConnected()) {
        throw new Error('MONGO_URI is required to migrate users into MongoDB.');
    }
    const store = wrapModel(getUserModel());
    for (const user of getAllFrontendUsers()) {
        await store.upsertOne({ slug: user.slug }, user);
    }
    console.log('Users migrated.');
    process.exit(0);
}

migrate().catch((error) => {
    console.error(error);
    process.exit(1);
});
