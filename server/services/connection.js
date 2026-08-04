const { getFrontendUserBySlug } = require('../frontend_user_configs');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function normalizeSlug(value) {
    const slug = String(value || '').trim().toLowerCase();
    return SLUG_PATTERN.test(slug) ? slug : '';
}

function hasStoredTokens(user) {
    return Boolean(user && user.refresh_token);
}

function isReconnectRequired(user) {
    return Boolean(user && (
        user.needs_reconnect
        || user.connection_status === 'reconnect_required'
        || user.connection_status === 'revoked'
    ));
}

function isUserConnected(user) {
    if (!user || isReconnectRequired(user) || !hasStoredTokens(user)) {
        return false;
    }
    return user.connection_status !== 'disconnected';
}

async function ensureKnownUser(userStore, slugValue) {
    const slug = normalizeSlug(slugValue);
    if (!slug) {
        return null;
    }
    const existing = await userStore.findOne({ slug });
    if (existing) {
        return existing;
    }
    const frontendUser = getFrontendUserBySlug(slug);
    if (!frontendUser) {
        return null;
    }
    const hasLegacyToken = Boolean(frontendUser.refresh_token);
    return userStore.upsertOne({ slug }, Object.assign({}, frontendUser, {
        connection_status: hasLegacyToken ? 'connected' : 'not_connected',
        needs_reconnect: false,
        oauth_application: 'legacy',
        migration_status: hasLegacyToken ? 'pending' : 'not_started'
    }));
}

function buildConnectionStatus(user) {
    const needsReconnect = isReconnectRequired(user);
    return {
        connected: isUserConnected(user),
        needsReconnect,
        stravaAthleteId: user && user.strava_id != null ? Number(user.strava_id) : null,
        lastSync: user && (user.last_successful_sync_at || user.last_sync)
            ? new Date(user.last_successful_sync_at || user.last_sync).toISOString()
            : null,
        connectionStatus: needsReconnect
            ? 'reconnect_required'
            : (isUserConnected(user) ? 'connected' : 'not_connected'),
        syncStatus: String((user && user.sync_status) || 'idle'),
        migrationStatus: String((user && user.migration_status) || 'not_started')
    };
}

async function markReconnectRequired(userStore, slugValue, reason) {
    const slug = normalizeSlug(slugValue);
    if (!slug) {
        return null;
    }
    return userStore.updateOne({ slug }, {
        connection_status: 'reconnect_required',
        needs_reconnect: true,
        sync_status: 'reconnect_required',
        sync_error: String(reason || 'Strava authorization must be renewed')
    });
}

function toPublicUser(user) {
    if (!user) {
        return null;
    }
    return {
        id: user._id || null,
        slug: user.slug,
        display_name: user.display_name,
        stravaAthleteId: user.strava_id != null ? Number(user.strava_id) : null,
        color: user.color || null,
        default_lat: user.default_lat,
        default_lng: user.default_lng,
        profile_pic: user.profile_pic || null,
        total_activities: Number(user.total_activities || 0),
        ...buildConnectionStatus(user)
    };
}

module.exports = {
    normalizeSlug,
    hasStoredTokens,
    isReconnectRequired,
    isUserConnected,
    ensureKnownUser,
    buildConnectionStatus,
    markReconnectRequired,
    toPublicUser
};
