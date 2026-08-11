(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        return;
    }
    root.MapWidgetLoader = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PRODUCTION_API_BASE = 'https://stravamap-production-7f28.up.railway.app';

    function resolveApiBase(windowObject) {
        const configuredBase = String(windowObject.STRAVA_CONFIG && windowObject.STRAVA_CONFIG.apiBase || '').trim();
        if (configuredBase) {
            return configuredBase.replace(/\/$/, '');
        }
        return ['localhost', '127.0.0.1'].indexOf(windowObject.location.hostname) !== -1
            ? windowObject.location.origin
            : PRODUCTION_API_BASE;
    }

    function buildPayloadUrl(windowObject, provider) {
        const sourceUrl = new URL(windowObject.location.href);
        const payloadUrl = new URL('/api/widget/activity-script', resolveApiBase(windowObject));
        payloadUrl.searchParams.set('provider', provider);
        payloadUrl.searchParams.set('user', sourceUrl.searchParams.get('user') || '');
        payloadUrl.searchParams.set('index', sourceUrl.searchParams.get('index') || '0');
        return payloadUrl.toString();
    }

    function escapeAttribute(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;');
    }

    function writePayloadScript(provider, windowObject, documentObject) {
        const activeWindow = windowObject || window;
        const activeDocument = documentObject || document;
        const normalizedProvider = String(provider || '').toLowerCase();
        if (['strava', 'intervals'].indexOf(normalizedProvider) === -1) {
            throw new Error('Unknown map widget provider.');
        }
        const source = escapeAttribute(buildPayloadUrl(activeWindow, normalizedProvider));
        activeDocument.write('<script src="' + source + '"></script>');
    }

    return {
        PRODUCTION_API_BASE,
        resolveApiBase,
        buildPayloadUrl,
        escapeAttribute,
        writePayloadScript
    };
}));
