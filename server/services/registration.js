const { normalizeSlug } = require('./connection');

const NAME_PATTERN = /^[A-Za-z]{1,32}$/;
const DEFAULT_MAP_CENTER = Object.freeze({ lat: 39.8283, lng: -98.5795 });
const USER_COLORS = Object.freeze([
    '#fc4c02',
    '#2563eb',
    '#16a34a',
    '#9333ea',
    '#db2777',
    '#0891b2',
    '#ca8a04',
    '#dc2626'
]);

class RegistrationError extends Error {
    constructor(message, statusCode, code, details) {
        super(message);
        this.name = 'RegistrationError';
        this.statusCode = statusCode || 400;
        this.code = code || 'registration_error';
        this.details = details || {};
    }
}

function normalizeName(value) {
    const name = String(value || '').trim();
    return NAME_PATTERN.test(name) ? name : '';
}

function deriveUserSlug(firstNameValue, lastNameValue) {
    const firstName = normalizeName(firstNameValue);
    const lastName = normalizeName(lastNameValue);
    if (!firstName || !lastName) {
        return '';
    }
    return normalizeSlug(`${firstName}${lastName}`.toLowerCase());
}

function colorForSlug(slug) {
    const hash = String(slug || '').split('').reduce((value, character) => {
        return ((value * 31) + character.charCodeAt(0)) >>> 0;
    }, 0);
    return USER_COLORS[hash % USER_COLORS.length];
}

function isDuplicateKeyError(error) {
    return Boolean(error && (error.code === 11000 || error.code === 11001));
}

async function registerNewUser(userStore, payload) {
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

    const existing = await userStore.findOne({ slug });
    if (existing) {
        throw new RegistrationError(
            'That map link is already in use.',
            409,
            'slug_taken',
            { slug }
        );
    }

    const newUser = {
        slug,
        display_name: firstName,
        color: colorForSlug(slug),
        default_lat: DEFAULT_MAP_CENTER.lat,
        default_lng: DEFAULT_MAP_CENTER.lng,
        num_pages: 10,
        connection_status: 'not_connected',
        needs_reconnect: false,
        oauth_application: 'primary',
        migration_status: 'not_started',
        sync_status: 'idle',
        total_activities: 0,
        backfill_complete: false
    };

    try {
        return await userStore.insertOne(newUser);
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw new RegistrationError(
                'That map link is already in use.',
                409,
                'slug_taken',
                { slug }
            );
        }
        throw error;
    }
}

module.exports = {
    NAME_PATTERN,
    DEFAULT_MAP_CENTER,
    RegistrationError,
    normalizeName,
    deriveUserSlug,
    registerNewUser
};
