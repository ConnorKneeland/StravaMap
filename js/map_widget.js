(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        return;
    }
    root.MapWidget = api;
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PRODUCTION_API_BASE = 'https://stravamap-production-7f28.up.railway.app';
    const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
    const PROVIDERS = {
        strava: {
            label: 'Strava',
            activitiesPath: '/api/activities'
        },
        intervals: {
            label: 'Intervals.icu',
            activitiesPath: '/api/intervals/activities'
        }
    };

    function parseWidgetRequest(locationValue) {
        const url = locationValue instanceof URL
            ? locationValue
            : new URL(String(locationValue || ''), 'https://widget.invalid/');
        const slug = String(url.searchParams.get('user') || '').trim().toLowerCase();
        if (!SLUG_PATTERN.test(slug)) {
            throw new Error('Add a valid user slug with ?user=<slug>.');
        }

        const rawIndex = String(url.searchParams.get('index') || '0').trim();
        if (!/^\d+$/.test(rawIndex)) {
            throw new Error('The index must be a whole number of 0 or greater.');
        }
        const index = Number(rawIndex);
        if (!Number.isSafeInteger(index)) {
            throw new Error('The requested workout index is too large.');
        }
        return { slug: slug, index: index };
    }

    function getActivityTimestamp(activity) {
        const value = activity && (activity.start_date || activity.start_date_local);
        const timestamp = new Date(value || 0).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function selectIndexedActivity(activities, index) {
        const sorted = (activities || []).slice().sort(function (left, right) {
            return getActivityTimestamp(right) - getActivityTimestamp(left);
        });
        if (index < 0 || index >= sorted.length) {
            throw new Error('Workout index ' + index + ' is not available for this user.');
        }
        return sorted[index];
    }

    function formatDuration(totalSeconds) {
        const roundedSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
        const hours = Math.floor(roundedSeconds / 3600);
        const minutes = Math.floor((roundedSeconds % 3600) / 60);
        const seconds = roundedSeconds % 60;
        return String(hours).padStart(2, '0')
            + ':' + String(minutes).padStart(2, '0')
            + ':' + String(seconds).padStart(2, '0');
    }

    function formatDistanceMiles(distanceMeters) {
        const miles = Math.max(0, Number(distanceMeters) || 0) * 0.000621371192;
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(miles);
    }

    function parseDisplayDate(value) {
        const raw = String(value || '').trim();
        const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (localMatch) {
            return new Date(Number(localMatch[1]), Number(localMatch[2]) - 1, Number(localMatch[3]));
        }
        return new Date(raw);
    }

    function formatActivityDate(activity) {
        const date = parseDisplayDate(activity && (activity.start_date_local || activity.start_date));
        if (Number.isNaN(date.getTime())) {
            return 'Unknown';
        }
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }

    function buildActivityKpis(activity) {
        const durationSeconds = Number(activity && activity.moving_time);
        return {
            time: formatDuration(Number.isFinite(durationSeconds) && durationSeconds > 0
                ? durationSeconds
                : activity && activity.elapsed_time),
            distance: formatDistanceMiles(activity && activity.distance),
            date: formatActivityDate(activity)
        };
    }

    function resolveApiBase(windowObject) {
        const configuredBase = String(windowObject.STRAVA_CONFIG && windowObject.STRAVA_CONFIG.apiBase || '').trim();
        if (configuredBase) {
            return configuredBase.replace(/\/$/, '');
        }
        return ['localhost', '127.0.0.1'].indexOf(windowObject.location.hostname) !== -1
            ? windowObject.location.origin
            : PRODUCTION_API_BASE;
    }

    function getIntervalsOwnerToken(windowObject, slug) {
        try {
            return windowObject.sessionStorage.getItem('intervals_icu_' + slug + '_owner_session') || '';
        } catch (error) {
            return '';
        }
    }

    function getRequestOptions(provider, ownerToken, timeoutMs) {
        const options = {
            timeoutMs: timeoutMs,
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            }
        };
        if (provider === 'intervals' && ownerToken) {
            options.headers.Authorization = 'Bearer ' + ownerToken;
        }
        return options;
    }

    async function refreshProviderCache(app, apiBase, provider, slug, ownerToken) {
        if (provider === 'intervals' && !ownerToken) {
            return;
        }
        const syncPath = provider === 'intervals'
            ? '/api/intervals/sync/' + encodeURIComponent(slug)
            : '/api/sync/' + encodeURIComponent(slug);
        try {
            await app.apiPost(apiBase, syncPath, {}, getRequestOptions(provider, ownerToken, 45000));
        } catch (error) {
            // A cached public workout is still useful when an upstream sync is unavailable.
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[Map Widget] Unable to refresh ' + PROVIDERS[provider].label + '; using cached activities.', error);
            }
        }
    }

    async function fetchActivities(app, apiBase, provider, slug, index, ownerToken) {
        const activities = await app.apiGet(
            apiBase,
            PROVIDERS[provider].activitiesPath,
            { user: slug, limit: index + 1 },
            getRequestOptions(provider, ownerToken, 45000)
        );
        if (!Array.isArray(activities)) {
            throw new Error('The workout service returned an unexpected response.');
        }
        return activities.map(app.normalizeActivityRecord);
    }

    function renderKpis(documentObject, activity) {
        const kpis = buildActivityKpis(activity);
        documentObject.getElementById('kpi-time').textContent = kpis.time;
        documentObject.getElementById('kpi-distance').textContent = kpis.distance;
        documentObject.getElementById('kpi-date').textContent = kpis.date;
    }

    function disableMapInteractions(map) {
        ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard', 'tap'].forEach(function (handlerName) {
            if (map[handlerName] && typeof map[handlerName].disable === 'function') {
                map[handlerName].disable();
            }
        });
    }

    function waitForTileLayer(tileLayer, timeoutMs) {
        return new Promise(function (resolve) {
            let settled = false;
            const timeoutId = setTimeout(finish, timeoutMs);
            function finish() {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                if (tileLayer && typeof tileLayer.off === 'function') {
                    tileLayer.off('load', finish);
                }
                resolve();
            }
            if (tileLayer && typeof tileLayer.once === 'function') {
                tileLayer.once('load', finish);
            }
        });
    }

    async function renderStaticMap(windowObject, documentObject, app, descriptor) {
        const leaflet = windowObject.L;
        const initialPoint = descriptor.coordinates[0];
        const map = leaflet.map('map', {
            zoomControl: false,
            attributionControl: true,
            dragging: false,
            touchZoom: false,
            doubleClickZoom: false,
            scrollWheelZoom: false,
            boxZoom: false,
            keyboard: false,
            zoomAnimation: false,
            fadeAnimation: false,
            markerZoomAnimation: false
        });
        disableMapInteractions(map);
        map.setView(initialPoint, 13, { animate: false });

        const tileLayer = app.createBaseTileLayer('light');
        const tileReady = waitForTileLayer(tileLayer, 5000);
        tileLayer.addTo(map);

        const routeStyle = Object.assign({}, descriptor.style, {
            interactive: false,
            bubblingMouseEvents: false
        });
        leaflet.polyline(descriptor.renderCoordinates || descriptor.coordinates, routeStyle).addTo(map);

        const bounds = leaflet.latLngBounds(descriptor.coordinates);
        const kpiStrip = documentObject.getElementById('kpi-strip');
        const topPadding = Math.max(76, Number(kpiStrip && kpiStrip.offsetHeight || 0)) + 22;
        map.invalidateSize({ animate: false });
        if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, {
                paddingTopLeft: [28, topPadding],
                paddingBottomRight: [28, 28],
                maxZoom: 17,
                animate: false
            });
        }

        await tileReady;
        return map;
    }

    function getPreloadedActivity(payload, request, provider) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }
        if (payload.error) {
            throw new Error(String(payload.error));
        }
        if (payload.provider !== provider
            || payload.user !== request.slug
            || Number(payload.index) !== request.index
            || !payload.activity) {
            return null;
        }
        return payload.activity;
    }

    function showError(documentObject, error) {
        const message = error && error.message
            ? error.message
            : 'The selected workout could not be loaded.';
        documentObject.getElementById('error-message').textContent = message;
        documentObject.body.dataset.state = 'error';
        documentObject.body.setAttribute('aria-busy', 'false');
        documentObject.documentElement.dataset.mapWidgetError = 'true';
    }

    async function bootstrap(options) {
        const opts = options || {};
        const provider = String(opts.provider || '').toLowerCase();
        if (!PROVIDERS[provider]) {
            throw new Error('Unknown map widget provider.');
        }

        const windowObject = opts.window || window;
        const documentObject = opts.document || document;
        const app = opts.app || windowObject.StravaApp;
        delete documentObject.documentElement.dataset.mapWidgetReady;
        delete documentObject.documentElement.dataset.mapWidgetError;
        documentObject.body.dataset.state = 'loading';
        documentObject.body.setAttribute('aria-busy', 'true');

        try {
            if (!app || !windowObject.L || typeof app.createBaseTileLayer !== 'function') {
                throw new Error('The map library did not load.');
            }
            const request = parseWidgetRequest(windowObject.location.href);
            const apiBase = resolveApiBase(windowObject);
            const ownerToken = provider === 'intervals' ? getIntervalsOwnerToken(windowObject, request.slug) : '';
            const preloadedActivity = getPreloadedActivity(
                opts.payload || windowObject.__MAP_WIDGET_PAYLOAD__,
                request,
                provider
            );
            let activity;
            if (preloadedActivity) {
                activity = app.normalizeActivityRecord(preloadedActivity);
            } else {
                await refreshProviderCache(app, apiBase, provider, request.slug, ownerToken);
                const activities = await fetchActivities(app, apiBase, provider, request.slug, request.index, ownerToken);
                activity = selectIndexedActivity(activities, request.index);
            }
            const descriptor = app.createActivityDescriptor(activity, {
                userSlug: request.slug,
                lineWeight: 5,
                opacityWeight: 0.9
            });
            if (!descriptor || !Array.isArray(descriptor.coordinates) || descriptor.coordinates.length < 2) {
                throw new Error('Workout index ' + request.index + ' does not contain a drawable route.');
            }

            renderKpis(documentObject, activity);
            const map = await renderStaticMap(windowObject, documentObject, app, descriptor);
            documentObject.documentElement.dataset.mapWidgetReady = 'true';
            documentObject.body.dataset.state = 'ready';
            documentObject.body.setAttribute('aria-busy', 'false');
            windowObject.dispatchEvent(new windowObject.CustomEvent('map-widget-ready', {
                detail: {
                    provider: provider,
                    user: request.slug,
                    index: request.index,
                    activityId: String(activity.id || activity.strava_id || activity.intervals_activity_id || '')
                }
            }));
            return { map: map, activity: activity, descriptor: descriptor };
        } catch (error) {
            showError(documentObject, error);
            return null;
        }
    }

    return {
        bootstrap: bootstrap,
        parseWidgetRequest: parseWidgetRequest,
        selectIndexedActivity: selectIndexedActivity,
        formatDuration: formatDuration,
        formatDistanceMiles: formatDistanceMiles,
        formatActivityDate: formatActivityDate,
        buildActivityKpis: buildActivityKpis,
        getPreloadedActivity: getPreloadedActivity
    };
}));
