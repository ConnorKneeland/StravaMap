const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STRAVA_SHARED_PATH = path.resolve(__dirname, '..', 'js', 'strava_shared.js');
const USER_CONFIG_MARKER = 'const USER_CONFIGS =';

function extractObjectLiteral(source, marker) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error('Unable to locate USER_CONFIGS in js/strava_shared.js');
    }
    const startIndex = source.indexOf('{', markerIndex);
    if (startIndex === -1) {
        throw new Error('Unable to locate USER_CONFIGS object start');
    }
    let depth = 0;
    let inString = false;
    let stringQuote = '';
    let isEscaped = false;
    for (let index = startIndex; index < source.length; index += 1) {
        const char = source[index];
        if (inString) {
            if (isEscaped) {
                isEscaped = false;
            } else if (char === '\\') {
                isEscaped = true;
            } else if (char === stringQuote) {
                inString = false;
                stringQuote = '';
            }
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            inString = true;
            stringQuote = char;
            continue;
        }
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, index + 1);
            }
        }
    }
    throw new Error('Unable to locate USER_CONFIGS object end');
}

function loadRawFrontendUserConfigs() {
    const source = fs.readFileSync(STRAVA_SHARED_PATH, 'utf8');
    const objectLiteral = extractObjectLiteral(source, USER_CONFIG_MARKER);
    return vm.runInNewContext(`(${objectLiteral})`);
}

function mapFrontendConfigToBackendUser(config) {
    return {
        display_name: config.displayName,
        slug: config.slug,
        client_id: Number(config.clientId),
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        color: config.color,
        default_lat: Number(config.lat),
        default_lng: Number(config.lng),
        num_pages: Number(config.pages || 1)
    };
}

function getAllFrontendUsers() {
    const rawConfigs = loadRawFrontendUserConfigs();
    return Object.values(rawConfigs || {}).map(mapFrontendConfigToBackendUser);
}

function getFrontendUserBySlug(slug) {
    const rawConfigs = loadRawFrontendUserConfigs();
    const config = rawConfigs && rawConfigs[String(slug || '').toLowerCase()];
    return config ? mapFrontendConfigToBackendUser(config) : null;
}

module.exports = {
    getAllFrontendUsers,
    getFrontendUserBySlug
};
