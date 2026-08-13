const { isMongoConnected, memoryStore, wrapModel } = require('../db');
const getUserModel = require('../models/user');
const { normalizeSlug } = require('./connection');
const {
    RegistrationError,
    deriveUserSlug,
    normalizeName,
    registerNewUser
} = require('./registration');
const {
    verifyIntervalsApiKey,
    assertIntervalsApiKeyConnectionAvailable,
    storeIntervalsApiKeyConnection,
    createOwnerToken,
    normalizeIntervalsReturnUrl
} = require('./intervals_auth');

class IntervalsRegistrationError extends Error {
    constructor(message, statusCode, code, details) {
        super(message);
        this.name = 'IntervalsRegistrationError';
        this.statusCode = statusCode || 400;
        this.code = code || 'intervals_registration_error';
        this.details = details || {};
    }
}

function getUserStore() {
    return isMongoConnected() ? wrapModel(getUserModel()) : memoryStore.users;
}

function getRegistrationIdentity(payload) {
    const mode = String(payload && payload.mode || '').trim().toLowerCase();
    if (!['existing', 'new'].includes(mode)) {
        throw new IntervalsRegistrationError(
            'Choose whether you already have a map.',
            400,
            'invalid_registration_mode'
        );
    }
    if (payload.confirmed !== true) {
        throw new IntervalsRegistrationError(
            mode === 'existing'
                ? 'Confirm that the URL is your existing map and not someone else\'s.'
                : 'You must agree to make this map.',
            400,
            'confirmation_required'
        );
    }

    if (mode === 'existing') {
        const slug = normalizeSlug(payload && payload.slug);
        if (!slug) {
            throw new IntervalsRegistrationError(
                'Enter a valid map slug from your existing map URL.',
                400,
                'invalid_slug'
            );
        }
        return { mode, slug };
    }

    const firstName = normalizeName(payload && payload.first_name);
    const lastName = normalizeName(payload && payload.last_name);
    const slug = deriveUserSlug(firstName, lastName);
    if (!slug) {
        throw new RegistrationError(
            'Enter a first and last name using letters only.',
            400,
            'invalid_name'
        );
    }
    return { mode, slug, firstName, lastName };
}

async function registerIntervalsAccount(payload) {
    const identity = getRegistrationIdentity(payload || {});
    const userStore = getUserStore();
    const existingUser = await userStore.findOne({ slug: identity.slug });

    if (identity.mode === 'existing' && !existingUser) {
        throw new IntervalsRegistrationError(
            'That map slug was not found. Check your current map URL and try again.',
            404,
            'user_not_found',
            { slug: identity.slug }
        );
    }
    if (identity.mode === 'new' && existingUser) {
        throw new RegistrationError(
            'That map link is already in use. Choose “I already have a map” instead.',
            409,
            'slug_taken',
            { slug: identity.slug }
        );
    }

    const profile = await verifyIntervalsApiKey(payload.api_key, payload.athlete_id);
    await assertIntervalsApiKeyConnectionAvailable(identity.slug, profile.id);

    const ownerToken = createOwnerToken(identity.slug, profile.id);
    const mapUrl = normalizeIntervalsReturnUrl(
        payload.return_url,
        identity.slug,
        true,
        ownerToken
    );

    let createdUser = null;
    if (identity.mode === 'new') {
        createdUser = await registerNewUser(userStore, {
            first_name: identity.firstName,
            last_name: identity.lastName
        });
    }

    try {
        await storeIntervalsApiKeyConnection(identity.slug, profile, payload.api_key);
    } catch (error) {
        if (createdUser) {
            await userStore.deleteOne({ _id: createdUser._id, slug: identity.slug }).catch(() => null);
        }
        throw error;
    }

    return {
        created: Boolean(createdUser),
        slug: identity.slug,
        map_url: mapUrl
    };
}

module.exports = {
    IntervalsRegistrationError,
    getUserStore,
    getRegistrationIdentity,
    registerIntervalsAccount
};
