(function (window) {
    'use strict';

    const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/token';
    const STRAVA_API_BASE_URL = 'https://www.strava.com/api/v3';
    const STRAVA_ACTIVITIES_URL = `${STRAVA_API_BASE_URL}/athlete/activities`;
    const MAPBOX_LIGHT_STYLE_URL = 'https://api.mapbox.com/styles/v1/ckneeland/clczd9zd6001515pj5yvlalza/tiles/{z}/{x}/{y}?access_token={accessToken}';
    const MAPBOX_DARK_STYLE_URL = 'https://api.mapbox.com/styles/v1/ckneeland/cmnw43y4e004d01s3etqn419c/tiles/512/{z}/{x}/{y}?access_token=pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw';
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw';
    const MAPBOX_DARK_ACCESS_TOKEN = 'pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw';
    const MOBILE_REGEX = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const MAP_RENDER_ROUTE_CONFIG = {
        maxPointsDesktop: 900,
        maxPointsMobile: 650,
        toleranceMetersDesktop: 4,
        toleranceMetersMobile: 7
    };
    const TOOLTIP_OPTIONS = {
        permanent: false,
        sticky: true,
        direction: 'top',
        offset: [0, -18],
        className: 'left-align strava-tooltip'
    };
    const STRAVA_STREAM_REGISTRY = Object.freeze({
        time: { key: 'time', type: 'number[]', unit: 'seconds', availability: 'activity_stream' },
        distance: { key: 'distance', type: 'number[]', unit: 'meters', availability: 'activity_stream' },
        latlng: { key: 'latlng', type: '[lat,lng][]', unit: 'coordinates', availability: 'activity_stream' },
        altitude: { key: 'altitude', type: 'number[]', unit: 'meters', availability: 'activity_stream' },
        velocity_smooth: { key: 'velocity_smooth', type: 'number[]', unit: 'meters/second', availability: 'activity_stream' },
        heartrate: { key: 'heartrate', type: 'number[]', unit: 'bpm', availability: 'activity_stream' },
        cadence: { key: 'cadence', type: 'number[]', unit: 'rpm', availability: 'activity_stream' },
        watts: { key: 'watts', type: 'number[]', unit: 'watts', availability: 'activity_stream' },
        temp: { key: 'temp', type: 'number[]', unit: 'Celsius', availability: 'activity_stream' },
        moving: { key: 'moving', type: 'boolean[]', unit: 'boolean', availability: 'activity_stream' },
        grade_smooth: { key: 'grade_smooth', type: 'number[]', unit: 'percent grade', availability: 'activity_stream' }
    });
    const STRAVA_STREAM_PROFILES = Object.freeze({
        route: ['latlng', 'time'],
        speed: ['latlng', 'velocity_smooth', 'time'],
        full: Object.keys(STRAVA_STREAM_REGISTRY)
    });
    const SUMMARY_LABEL_MAP = {
        run: 'Run',
        trailrun: 'Trail Run',
        virtualrun: 'Virtual Run',
        walk: 'Walk',
        ride: 'Cycling',
        mountainbikeride: 'Mountain Biking',
        gravelride: 'Gravel Ride',
        ebikeride: 'Cycling',
        emountainbikeride: 'Mountain Biking',
        velomobile: 'Velomobile',
        virtualride: 'Virtual Ride',
        swim: 'Swimming',
        canoe: 'Canoe',
        kayak: 'Kayak',
        kayaking: 'Kayaking',
        kitesurf: 'Kitesurf',
        rowing: 'Rowing',
        standuppaddling: 'Paddleboarding',
        surf: 'Surfing',
        windsurf: 'Windsurf',
        sail: 'Sailing',
        alpineski: 'Skiing',
        backcountryski: 'Skiing',
        nordicski: 'Skiing',
        snowboard: 'Snowboard',
        snowshoe: 'Snowshoe',
        iceskate: 'Ice Skate',
        inlineskate: 'Inline Skate',
        skateboard: 'Skateboard',
        rockclimb: 'Rock Climb',
        rollerski: 'Roller Ski',
        handcycle: 'Handcycle',
        soccer: 'Soccer',
        golf: 'Golf',
        wheelchair: 'Wheelchair',
        badminton: 'Badminton',
        tennis: 'Tennis',
        pickleball: 'Pickleball',
        tabletennis: 'Table Tennis',
        squash: 'Squash',
        hiit: 'HIIT',
        pilates: 'Pilates',
        yoga: 'Yoga',
        weighttraining: 'Indoor Training',
        crossfit: 'Indoor Training',
        elliptical: 'Indoor Training',
        stairstepper: 'Indoor Training',
        workout: 'Indoor Training'
    };
    const SUMMARY_COLOR_MAP = {
        run: '#ff412e',
        trailrun: '#393b79',
        virtualrun: '#2ca02c',
        walk: '#000000',
        ride: '#F28E2B',
        mountainbikeride: '#9467bd',
        gravelride: '#8c564b',
        ebikeride: '#e377c2',
        emountainbikeride: '#7f7f7f',
        velomobile: '#bcbd22',
        virtualride: '#17becf',
        swim: '#1f77b4',
        canoe: '#5254a3',
        kayak: '#6b6ecf',
        kayaking: '#6b6ecf',
        kitesurf: '#9c9ede',
        rowing: '#637939',
        standuppaddling: '#8ca252',
        surf: '#b5cf6b',
        windsurf: '#cedb9c',
        sail: '#8c6d31',
        alpineski: '#5f99cf',
        backcountryski: '#5f99cf',
        nordicski: '#5f99cf',
        snowboard: '#843c39',
        snowshoe: '#a55194',
        iceskate: '#ce6dbd',
        inlineskate: '#de9ed6',
        skateboard: '#1f77b4',
        rockclimb: '#ff7f0e',
        rollerski: '#2ca02c',
        handcycle: '#d62728',
        soccer: '#9467bd',
        golf: '#8c564b',
        wheelchair: '#e377c2',
        badminton: '#7f7f7f',
        tennis: '#bcbd22',
        pickleball: '#17becf',
        tabletennis: '#393b79',
        squash: '#5254a3',
        hiit: '#6b6ecf',
        pilates: '#9c9ede',
        yoga: '#637939',
        weighttraining: '#8ca252',
        crossfit: '#b5cf6b',
        elliptical: '#cedb9c',
        stairstepper: '#8c6d31',
        workout: '#bd9e39',
        default: '#17becf'
    };
    const TYPE_LABEL_MAP = {
        run: 'Run',
        trailrun: 'Trail Run',
        virtualrun: 'Virtual Run',
        walk: 'Walk',
        ride: 'Ride',
        mountainbikeride: 'Mountain Bike Ride',
        gravelride: 'Gravel Ride',
        ebikeride: 'E-Bike Ride',
        emountainbikeride: 'E-Mountain Bike Ride',
        velomobile: 'Velomobile',
        virtualride: 'Virtual Ride',
        swim: 'Swim',
        canoe: 'Canoe',
        kayak: 'Kayak',
        kayaking: 'Kayaking',
        kitesurf: 'Kitesurf',
        rowing: 'Rowing',
        standuppaddling: 'Stand Up Paddling',
        surf: 'Surf',
        windsurf: 'Windsurf',
        sail: 'Sail',
        alpineski: 'Alpine Ski',
        backcountryski: 'Backcountry Ski',
        nordicski: 'Nordic Ski',
        snowboard: 'Snowboard',
        snowshoe: 'Snowshoe',
        iceskate: 'Ice Skate',
        inlineskate: 'Inline Skate',
        skateboard: 'Skateboard',
        rockclimb: 'Rock Climb',
        rollerski: 'Roller Ski',
        handcycle: 'Handcycle',
        soccer: 'Soccer',
        golf: 'Golf',
        wheelchair: 'Wheelchair',
        badminton: 'Badminton',
        tennis: 'Tennis',
        pickleball: 'Pickleball',
        tabletennis: 'Table Tennis',
        squash: 'Squash',
        hiit: 'HIIT',
        pilates: 'Pilates',
        yoga: 'Yoga',
        weighttraining: 'Weight Training',
        crossfit: 'Crossfit',
        elliptical: 'Elliptical',
        stairstepper: 'Stair Stepper',
        workout: 'Workout'
    };
    const ACTIVITY_COLOR_MAP = {
        run: '#ff0000',
        trailrun: '#ff0000',
        virtualrun: '#ff0000',
        ride: '#ff8000',
        mountainbikeride: '#ff8000',
        gravelride: '#ff8000',
        ebikeride: '#ff8000',
        emountainbikeride: '#ff8000',
        velomobile: '#ff8000',
        virtualride: '#ff8000',
        swim: '#1648ebff',
        walk: '#000000',
        alpineski: '#5f99cf',
        backcountryski: '#5f99cf',
        nordicski: '#5f99cf',
        snowboard: '#5f99cf',
        golf: '#0a7b0a',
        default: '#800080'
    };
    const ROUTE_SMOOTHING_CONFIG = {
        enabled: true,
        iterations: 1,
        tension: 0.18,
        maxSourcePoints: 500
    };
    const USER_CONFIGS = {
        connor: { slug: 'connor', displayName: 'Connor', title: "Connor's Map", clientId: 162238, clientSecret: '526b6989b62616ce1416f27e0414866958666013', refreshToken: '23227cb9c49a632130451aa2206241479b6dd842', lat: 43.0722, lng: -89.4008, pages: 10, color: '#ff412e' },
        tim: { slug: 'tim', displayName: 'Tim', title: "Tim's Map", clientId: 100558, clientSecret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refreshToken: 'fd40d09e3d95895eda12334f5a6254db341ac516', lat: 44.4347, lng: -88.0679, pages: 30, color: '#ff8000ff' },
        quinn: { slug: 'quinn', displayName: 'Quinn', title: "Quinn's Map", clientId: 100558, clientSecret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refreshToken: '93bfb1298cb4e356053a8116127327d78a607608', lat: 43.034, lng: -87.912, pages: 10, color: '#1648ebff' },
        michael: { slug: 'michael', displayName: 'Michael', title: "Michael's Map", clientId: 162250, clientSecret: '730145084c5ba6dce48c112dee1156c426ee951c', refreshToken: 'b769e8affe3469c2acf39bfca5752ef06fea5f1d', lat: 44.43475, lng: -88.06789, pages: 10, color: '#0a7b0a' },
        mwelsh: { slug: 'mwelsh', displayName: 'Mwelsh', title: "Mwelsh's Map", clientId: 216000, clientSecret: '1cf9ccdbac63f92e3c62991df61b030bf1329f47', refreshToken: '6ce920762a92619324899932cca36fd33a90e119', lat: 43.0722, lng: -89.4008, pages: 5, color: '#8c564b' },
        kemily: { slug: 'kemily', displayName: 'Kemily', title: "Kemily's Map", clientId: 249867, clientSecret: 'b18781e72b031c087a3e1ad70d143ec7e0c79b12', refreshToken: 'fbde056c0d903b952e7e9fc3da70f5c1a17b9957', lat: 43.0722, lng: -89.4008, pages: 10, color: '#d45087' },
        lee: { slug: 'lee', displayName: 'Lee', title: "Lee's Map", clientId: 100558, clientSecret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refreshToken: '6568dbed5af3c4fa40e7dabc6f5768039e2cb53d', lat: 39.6351, lng: -106.5221, pages: 12, color: '#bcbd22' }
    };

    window.STRAVA_CONFIG = Object.assign({ apiBase: '' }, window.STRAVA_CONFIG || {});

    function getMiles(i) {
        return i * 0.000621371192;
    }

    function formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        let formattedTime = '';
        if (hrs > 0) {
            formattedTime += `${hrs} hr `;
        }
        if (mins > 0) {
            formattedTime += `${mins} min `;
        }
        if (secs > 0 || formattedTime === '') {
            formattedTime += `${secs} sec`;
        }
        return formattedTime.trim();
    }

    function convertMphToPace(mph) {
        const minutesPerMile = 60 / mph;
        const mins = Math.floor(minutesPerMile);
        const secs = Math.round((minutesPerMile - mins) * 60);
        return `${mins} min ${secs} sec per mile`;
    }

    function parseDateValue(dateString) {
        const value = String(dateString || '').trim();
        if (!value) {
            return null;
        }
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (match) {
            return new Date(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
                Number(match[4] || 0),
                Number(match[5] || 0),
                Number(match[6] || 0)
            );
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatDate(dateString) {
        const date = parseDateValue(dateString);
        if (!date) {
            return '';
        }
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const day = date.getDate();
        const monthIndex = date.getMonth();
        const year = date.getFullYear();
        const daySuffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
        return `${monthNames[monthIndex]} ${day}${daySuffix}, ${year}`;
    }

    function formatClockTime(dateString) {
        const date = parseDateValue(dateString);
        if (!date) {
            return '';
        }
        let hours = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const meridiem = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        return `${String(hours).padStart(2, '0')}:${minutes} ${meridiem}`;
    }

    function ordinal(n) {
        const suffixes = ['th', 'st', 'nd', 'rd'];
        const value = n % 100;
        return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
    }

    function wait(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, ms);
        });
    }

    function getLineStyle() {
        const isMobile = MOBILE_REGEX.test(window.navigator.userAgent);
        const baseWeightMultiplier = window.StravaAnimated && typeof window.StravaAnimated.getBaseLineWeightMultiplier === 'function'
            ? window.StravaAnimated.getBaseLineWeightMultiplier()
            : 1;
        return {
            isMobile: isMobile,
            LINE_WEIGHT: (isMobile ? 5 : 3.25) * baseWeightMultiplier,
            OPACITY_WEIGHT: isMobile ? 0.5 : 0.8
        };
    }

    function normalizeActivityRecord(activity) {
        const normalized = Object.assign({}, activity);
        normalized.map = Object.assign({}, activity.map || {});
        if (!normalized.id && activity.strava_id) {
            normalized.id = activity.strava_id;
        }
        if (!normalized.map.id && normalized.map_id) {
            normalized.map.id = normalized.map_id;
        }
        if (!normalized.map.polyline && normalized.map_polyline) {
            normalized.map.polyline = normalized.map_polyline;
        }
        if (!normalized.map.resource_state && normalized.map_resource_state !== undefined && normalized.map_resource_state !== null) {
            normalized.map.resource_state = normalized.map_resource_state;
        }
        if (!normalized.map.summary_polyline && normalized.summary_polyline) {
            normalized.map.summary_polyline = normalized.summary_polyline;
        }
        if (!normalized.map.summary_polyline && normalized.map_summary_polyline) {
            normalized.map.summary_polyline = normalized.map_summary_polyline;
        }
        if (!normalized.map.city && normalized.map_city) {
            normalized.map.city = normalized.map_city;
        }
        if (!normalized.map.state && normalized.map_state) {
            normalized.map.state = normalized.map_state;
        }
        if (!normalized.map.country && normalized.map_country) {
            normalized.map.country = normalized.map_country;
        }
        if (!normalized.city && (normalized.location_city || normalized.map_city || normalized.map.city)) {
            normalized.city = normalized.location_city || normalized.map_city || normalized.map.city;
        }
        if (!normalized.state && (normalized.location_state || normalized.map_state || normalized.map.state)) {
            normalized.state = normalized.location_state || normalized.map_state || normalized.map.state;
        }
        if (!normalized.country && (normalized.location_country || normalized.map_country || normalized.map.country)) {
            normalized.country = normalized.location_country || normalized.map_country || normalized.map.country;
        }
        if (!normalized.start_latlng && activity.start_latlng) {
            normalized.start_latlng = activity.start_latlng;
        }
        if (!normalized.end_latlng && activity.end_latlng) {
            normalized.end_latlng = activity.end_latlng;
        }
        if (!normalized.line_color && activity.custom_line_color) {
            normalized.line_color = activity.custom_line_color;
        }
        if (normalized.line_thickness === undefined && activity.line_weight !== undefined) {
            normalized.line_thickness = activity.line_weight;
        }
        if (normalized.line_thickness === undefined && activity.custom_line_thickness !== undefined) {
            normalized.line_thickness = activity.custom_line_thickness;
        }
        if (normalized.line_opacity === undefined && activity.custom_line_opacity !== undefined) {
            normalized.line_opacity = activity.custom_line_opacity;
        }
        if (normalized.animation_speed_multiplier === undefined && activity.custom_animation_speed_multiplier !== undefined) {
            normalized.animation_speed_multiplier = activity.custom_animation_speed_multiplier;
        }
        return normalized;
    }

    function normalizeActivityType(activity) {
        const normalized = normalizeActivityRecord(activity);
        let type = String(normalized.type || '').toLowerCase();
        if (type === 'workout' && normalized.sport_type) {
            type = String(normalized.sport_type).toLowerCase();
        }
        return type;
    }

    function getActivityLabel(type) {
        const key = String(type || '').toLowerCase();
        return TYPE_LABEL_MAP[key] || SUMMARY_LABEL_MAP[key] || key.replace(/(^\w)|(\s+\w)/g, function (match) {
            return match.toUpperCase();
        });
    }

    function normalizeHexColor(value) {
        const raw = String(value || '').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
            return raw.toLowerCase();
        }
        if (/^#[0-9a-fA-F]{8}$/.test(raw)) {
            return raw.slice(0, 7).toLowerCase();
        }
        if (/^[0-9a-fA-F]{6}$/.test(raw)) {
            return ('#' + raw).toLowerCase();
        }
        if (/^[0-9a-fA-F]{8}$/.test(raw)) {
            return ('#' + raw.slice(0, 6)).toLowerCase();
        }
        if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
            return ('#' + raw.slice(1).split('').map(function (character) {
                return character + character;
            }).join('')).toLowerCase();
        }
        if (/^[0-9a-fA-F]{3}$/.test(raw)) {
            return ('#' + raw.split('').map(function (character) {
                return character + character;
            }).join('')).toLowerCase();
        }
        return '';
    }

    function getDefaultActivityColor(activity) {
        const type = normalizeActivityType(activity);
        return ACTIVITY_COLOR_MAP[type] || ACTIVITY_COLOR_MAP.default;
    }

    function getActivityColor(activity) {
        const normalized = normalizeActivityRecord(activity);
        return normalizeHexColor(normalized.line_color) || getDefaultActivityColor(normalized);
    }

    function normalizeLineThickness(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return null;
        }
        return Math.max(1, Math.min(32, numeric));
    }

    function normalizeLineOpacity(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        let numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        if (numeric > 1) {
            numeric /= 100;
        }
        return Math.max(0, Math.min(1, numeric));
    }

    function normalizeAnimationSpeedMultiplier(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return null;
        }
        return Math.max(0.25, Math.min(4, numeric));
    }

    function getActivityLineWeight(activity, fallbackWeight) {
        const normalized = normalizeActivityRecord(activity);
        const customWeight = normalizeLineThickness(normalized.line_thickness);
        return customWeight !== null ? customWeight : fallbackWeight;
    }

    function getActivityLineOpacity(activity, fallbackOpacity) {
        const normalized = normalizeActivityRecord(activity);
        const customOpacity = normalizeLineOpacity(normalized.line_opacity);
        return customOpacity !== null ? customOpacity : fallbackOpacity;
    }

    function getActivityAnimationSpeedMultiplier(activity, fallbackMultiplier) {
        const normalized = normalizeActivityRecord(activity);
        const customMultiplier = normalizeAnimationSpeedMultiplier(normalized.animation_speed_multiplier);
        return customMultiplier !== null ? customMultiplier : fallbackMultiplier;
    }

    function decodePolyline(encoded) {
        if (!encoded) {
            return [];
        }
        const coordinates = [];
        let index = 0;
        let lat = 0;
        let lng = 0;
        while (index < encoded.length) {
            let result = 0;
            let shift = 0;
            let byte = null;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            lat += (result & 1) ? ~(result >> 1) : (result >> 1);
            result = 0;
            shift = 0;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            lng += (result & 1) ? ~(result >> 1) : (result >> 1);
            coordinates.push([lat / 1e5, lng / 1e5]);
        }
        return coordinates;
    }

    function normalizeRouteCoordinates(points) {
        return (Array.isArray(points) ? points : []).map(function (point) {
            if (!Array.isArray(point) || point.length !== 2) {
                return null;
            }
            const lat = Number(point[0]);
            const lng = Number(point[1]);
            return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
        }).filter(Boolean);
    }

    function isMobileViewport() {
        return window.innerWidth <= 900 || MOBILE_REGEX.test(navigator.userAgent || '');
    }

    function getMapRenderMaxPoints() {
        const config = MAP_RENDER_ROUTE_CONFIG;
        const value = isMobileViewport() ? config.maxPointsMobile : config.maxPointsDesktop;
        return Math.max(2, Math.round(Number(value) || 900));
    }

    function getMapRenderToleranceMeters() {
        const config = MAP_RENDER_ROUTE_CONFIG;
        const value = isMobileViewport() ? config.toleranceMetersMobile : config.toleranceMetersDesktop;
        return Math.max(0.5, Number(value) || 4);
    }

    function projectRoutePoint(point, originLatitudeRadians) {
        const earthRadiusMeters = 6371008.8;
        const latitude = Number(point && point[0]);
        const longitude = Number(point && point[1]);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return null;
        }
        return {
            x: longitude * (Math.PI / 180) * earthRadiusMeters * Math.cos(originLatitudeRadians),
            y: latitude * (Math.PI / 180) * earthRadiusMeters
        };
    }

    function getRoutePointLineDistanceMeters(point, start, end) {
        const originLatitudeRadians = ((Number(point[0]) + Number(start[0]) + Number(end[0])) / 3) * (Math.PI / 180);
        const projectedPoint = projectRoutePoint(point, originLatitudeRadians);
        const projectedStart = projectRoutePoint(start, originLatitudeRadians);
        const projectedEnd = projectRoutePoint(end, originLatitudeRadians);
        if (!projectedPoint || !projectedStart || !projectedEnd) {
            return 0;
        }
        const deltaX = projectedEnd.x - projectedStart.x;
        const deltaY = projectedEnd.y - projectedStart.y;
        if (deltaX === 0 && deltaY === 0) {
            const pointDeltaX = projectedPoint.x - projectedStart.x;
            const pointDeltaY = projectedPoint.y - projectedStart.y;
            return Math.sqrt((pointDeltaX * pointDeltaX) + (pointDeltaY * pointDeltaY));
        }
        const ratio = Math.max(0, Math.min(1, (
            ((projectedPoint.x - projectedStart.x) * deltaX)
            + ((projectedPoint.y - projectedStart.y) * deltaY)
        ) / ((deltaX * deltaX) + (deltaY * deltaY))));
        const closestX = projectedStart.x + (deltaX * ratio);
        const closestY = projectedStart.y + (deltaY * ratio);
        const distanceX = projectedPoint.x - closestX;
        const distanceY = projectedPoint.y - closestY;
        return Math.sqrt((distanceX * distanceX) + (distanceY * distanceY));
    }

    function simplifyRouteIndices(points, toleranceMeters) {
        const totalPoints = points.length;
        if (totalPoints <= 2) {
            return points.map(function (_, index) { return index; });
        }
        const keep = new Uint8Array(totalPoints);
        const stack = [[0, totalPoints - 1]];
        keep[0] = 1;
        keep[totalPoints - 1] = 1;
        while (stack.length) {
            const range = stack.pop();
            const startIndex = range[0];
            const endIndex = range[1];
            let maxDistance = -1;
            let maxIndex = -1;
            for (let index = startIndex + 1; index < endIndex; index += 1) {
                const distance = getRoutePointLineDistanceMeters(points[index], points[startIndex], points[endIndex]);
                if (distance > maxDistance) {
                    maxDistance = distance;
                    maxIndex = index;
                }
            }
            if (maxIndex > startIndex && maxDistance > toleranceMeters) {
                keep[maxIndex] = 1;
                stack.push([startIndex, maxIndex]);
                stack.push([maxIndex, endIndex]);
            }
        }
        const indices = [];
        for (let index = 0; index < totalPoints; index += 1) {
            if (keep[index]) {
                indices.push(index);
            }
        }
        return indices;
    }

    function capRouteIndicesEvenly(indices, maxPoints) {
        if (indices.length <= maxPoints) {
            return indices;
        }
        const capped = [indices[0]];
        const seen = new Set(capped);
        for (let slot = 1; slot < maxPoints - 1; slot += 1) {
            const sourceIndex = Math.round((slot * (indices.length - 1)) / Math.max(maxPoints - 1, 1));
            const value = indices[Math.max(0, Math.min(indices.length - 1, sourceIndex))];
            if (!seen.has(value)) {
                capped.push(value);
                seen.add(value);
            }
        }
        const last = indices[indices.length - 1];
        if (!seen.has(last)) {
            capped.push(last);
        }
        return capped.sort(function (left, right) { return left - right; });
    }

    function getMapRenderRouteCoordinates(points, options) {
        const coordinates = normalizeRouteCoordinates(points);
        const opts = options || {};
        const maxPoints = Number.isFinite(Number(opts.maxPoints)) && Number(opts.maxPoints) >= 2
            ? Math.round(Number(opts.maxPoints))
            : getMapRenderMaxPoints();
        if (coordinates.length <= maxPoints) {
            return coordinates;
        }
        let tolerance = Number.isFinite(Number(opts.toleranceMeters)) && Number(opts.toleranceMeters) > 0
            ? Number(opts.toleranceMeters)
            : getMapRenderToleranceMeters();
        let indices = simplifyRouteIndices(coordinates, tolerance);
        for (let attempt = 0; attempt < 8 && indices.length > maxPoints; attempt += 1) {
            tolerance *= 1.45;
            indices = simplifyRouteIndices(coordinates, tolerance);
        }
        indices = capRouteIndicesEvenly(indices, maxPoints);
        return indices.map(function (index) {
            return coordinates[index];
        });
    }

    function getActivityRouteCoordinates(activity) {
        const normalized = normalizeActivityRecord(activity);
        const streamCoordinates = normalizeRouteCoordinates(normalized.stream_latlng);
        if (streamCoordinates.length > 1) {
            return streamCoordinates;
        }
        return smoothRouteCoordinates(decodePolyline(normalized.map && normalized.map.summary_polyline));
    }

    function interpolateRouteCoordinate(start, end, ratio) {
        return [
            start[0] + ((end[0] - start[0]) * ratio),
            start[1] + ((end[1] - start[1]) * ratio)
        ];
    }

    function smoothRouteCoordinates(points, options) {
        const config = Object.assign({}, ROUTE_SMOOTHING_CONFIG, options || {});
        let smoothed = normalizeRouteCoordinates(points);
        if (!config.enabled || smoothed.length < 3 || smoothed.length > config.maxSourcePoints) {
            return smoothed;
        }
        const iterations = Math.max(0, Math.min(3, Math.round(Number(config.iterations) || 0)));
        const tension = Math.max(0.05, Math.min(0.45, Number(config.tension) || 0.18));
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            const next = [smoothed[0]];
            for (let index = 0; index < smoothed.length - 1; index += 1) {
                const start = smoothed[index];
                const end = smoothed[index + 1];
                next.push(interpolateRouteCoordinate(start, end, tension));
                next.push(interpolateRouteCoordinate(start, end, 1 - tension));
            }
            next.push(smoothed[smoothed.length - 1]);
            smoothed = next;
        }
        return smoothed;
    }

    function createDataAccumulator() {
        const workoutData = {};
        const activityCounts = {};

        function add(activity) {
            const normalized = normalizeActivityRecord(activity);
            const date = String(normalized.start_date || '').split('T')[0];
            const type = normalizeActivityType(normalized);
            const roundedMiles = Number(getMiles(Number(normalized.distance || 0)).toFixed(2));
            activityCounts[type] = (activityCounts[type] || 0) + 1;
            if (!workoutData[date]) {
                workoutData[date] = { running: 0, cycling: 0, swimming: 0, walk: 0, snow_sport: 0, other: 0 };
            }
            if (type === 'run') {
                workoutData[date].running += roundedMiles;
            }
            if (type === 'ride') {
                workoutData[date].cycling += roundedMiles;
            }
            if (type === 'swim') {
                workoutData[date].swimming += roundedMiles;
            }
            if (type === 'walk') {
                workoutData[date].walk += roundedMiles;
            }
            if (type === 'alpineski' || type === 'backcountryski' || type === 'nordicski' || type === 'snowboard') {
                workoutData[date].snow_sport += roundedMiles;
            }
            if (type === 'kayaking' || type === 'golf' || type === 'standuppaddling') {
                workoutData[date].other += roundedMiles;
            }
        }

        return { workoutData: workoutData, activityCounts: activityCounts, add: add };
    }

    function getDailyMiles(dayData) {
        return Number(dayData.running || 0)
            + Number(dayData.cycling || 0)
            + Number(dayData.swimming || 0)
            + Number(dayData.walk || 0)
            + Number(dayData.snow_sport || 0)
            + Number(dayData.other || 0);
    }

    function drawMilesChart(elementId, workoutData, monthsBack) {
        const dates = Object.keys(workoutData || {});
        const runningMiles = dates.map(function (date) { return Number(workoutData[date].running || 0); });
        const cyclingMiles = dates.map(function (date) { return Number(workoutData[date].cycling || 0); });
        const swimmingMiles = dates.map(function (date) { return Number(workoutData[date].swimming || 0); });
        const walkMiles = dates.map(function (date) { return Number(workoutData[date].walk || 0); });
        const snowMiles = dates.map(function (date) { return Number(workoutData[date].snow_sport || 0); });
        const otherMiles = dates.map(function (date) { return Number(workoutData[date].other || 0); });
        const totalMiles = dates.map(function (date) { return getDailyMiles(workoutData[date]); });
        const currentDate = new Date();
        const startDate = new Date();
        startDate.setMonth(currentDate.getMonth() - (typeof monthsBack === 'number' ? monthsBack : 1));

        const traces = [
            { x: dates, y: runningMiles, name: 'Running', type: 'bar', marker: { color: '#d62728' } },
            { x: dates, y: cyclingMiles, name: 'Cycling', type: 'bar', marker: { color: '#F28E2B' } },
            { x: dates, y: swimmingMiles, name: 'Swimming', type: 'bar', marker: { color: '#1f77b4' } },
            { x: dates, y: walkMiles, name: 'Walking', type: 'bar', marker: { color: 'black' } },
            { x: dates, y: snowMiles, name: 'Snow Sports', type: 'bar', marker: { color: '#5f99cf' } },
            { x: dates, y: otherMiles, name: 'Other', type: 'bar', marker: { color: 'purple' } }
        ];

        const layout = {
            barmode: 'stack',
            title: 'Workout Miles by Day',
            dragmode: 'pan',
            xaxis: {
                title: 'Date',
                range: [startDate.toISOString().split('T')[0], currentDate.toISOString().split('T')[0]],
                rangeslider: { visible: false },
                type: 'date',
                fixedrange: false,
                tickmode: 'linear',
                tickformat: '%b %d, %Y',
                dtick: 86400000
            },
            yaxis: {
                title: 'Miles',
                range: [0, Math.max.apply(null, totalMiles.concat([0])) + 10]
            },
            bargap: 0.1,
            bargroupgap: 0.1,
            annotations: dates.map(function (date, index) {
                return {
                    x: date,
                    y: totalMiles[index],
                    text: `${parseFloat(totalMiles[index] || 0).toFixed(2)} mi`,
                    showarrow: false,
                    font: { size: 12 },
                    xanchor: 'center',
                    yanchor: 'center',
                    yshift: 10
                };
            })
        };

        window.Plotly.newPlot(elementId, traces, layout, { responsive: true });
    }

    function drawSummaryChart(elementId, activityCounts) {
        const counts = activityCounts || {};
        const categoryTotals = Object.entries(counts).reduce(function (accumulator, entry) {
            const label = SUMMARY_LABEL_MAP[entry[0]];
            if (label && entry[1] > 0) {
                accumulator[label] = (accumulator[label] || 0) + entry[1];
            }
            return accumulator;
        }, {});
        let categoryOrder = Object.keys(categoryTotals).sort(function (left, right) {
            return categoryTotals[right] - categoryTotals[left];
        });
        categoryOrder = categoryOrder.reverse();

        const traces = Object.entries(counts)
            .filter(function (entry) {
                return entry[1] > 0;
            })
            .map(function (entry) {
                const label = SUMMARY_LABEL_MAP[entry[0]];
                const x = categoryOrder.map(function (category) {
                    return category === label ? entry[1] : 0;
                });
                return {
                    x: x,
                    y: categoryOrder,
                    type: 'bar',
                    orientation: 'h',
                    marker: { color: SUMMARY_COLOR_MAP[entry[0]] || SUMMARY_COLOR_MAP.default },
                    showlegend: false,
                    text: x.map(function (value) { return value > 0 ? String(value) : ''; }),
                    textposition: 'inside',
                    textfont: { size: 16 }
                };
            });

        const layout = {
            title: { text: 'Total Number of Workouts by Type', font: { size: 30 } },
            barmode: 'stack',
            dragmode: 'pan',
            xaxis: {
                title: { text: 'Workout Count', font: { size: 20 } },
                tickfont: { size: 16 }
            },
            yaxis: {
                automargin: true,
                categoryorder: 'array',
                categoryarray: categoryOrder,
                tickfont: { size: 18 },
                tickpadding: 15,
                ticklabelposition: 'outside'
            },
            margin: { l: 200, t: 80, b: 60 },
            showlegend: false
        };

        window.Plotly.newPlot(elementId, traces, layout, { responsive: true });
    }

    function drawComparisonChart(elementId, usersData) {
        const data = usersData || [];
        const allDates = Array.from(new Set(data.flatMap(function (userData) {
            return Object.keys(userData.workoutData || {});
        }))).sort();

        const traces = data.map(function (userData) {
            return {
                x: allDates,
                y: allDates.map(function (date) {
                    return getDailyMiles((userData.workoutData || {})[date] || {});
                }),
                name: userData.name,
                type: 'bar',
                marker: { color: userData.color }
            };
        });

        const layout = {
            barmode: 'group',
            title: 'Workout Miles by Day',
            dragmode: 'pan',
            xaxis: {
                title: 'Date',
                type: 'date',
                fixedrange: false,
                tickmode: 'linear',
                tickformat: '%b %d, %Y',
                dtick: 86400000
            },
            yaxis: {
                title: 'Miles'
            },
            bargap: 0.15,
            bargroupgap: 0.1
        };

        window.Plotly.newPlot(elementId, traces, layout, { responsive: true });
    }

    function buildTooltip(activity, options) {
        const normalized = normalizeActivityRecord(activity);
        const ownerName = options && options.ownerName ? options.ownerName : '';
        const displayDateTime = normalized.start_date_local || normalized.start_date;
        const formattedTime = formatClockTime(displayDateTime);
        const ownerMarkup = ownerName ? `<h3 style='margin-top: -5px;'><b> Owner: </b>${ownerName}</h3>` : '';
        const title = `<div class='strava-tooltip-card'><b class='strava-tooltip-title'>${normalized.name}</b>`;
        const date = `<h2>On ${formatDate(displayDateTime)}${formattedTime ? ` at ${formattedTime}` : ''}</h2>`;
        const distance = `${getMiles(Number(normalized.distance || 0)).toFixed(2)} miles`;
        const elapsedTime = Number(normalized.elapsed_time || 0);
        const averageSpeedMph = Number(normalized.average_speed || 0) * 2.2369362920544;
        const maxSpeedMph = Number(normalized.max_speed || 0) * 2.2369362920544;
        const elevationGainFeet = ((Number(normalized.elev_high || 0) - Number(normalized.elev_low || 0)) * 3.28084).toFixed(2);

        if (normalized.type === 'Run') {
            return title + date + ownerMarkup
                + `<h3 style='margin-top: -5px;'><b> Workout: </b>${normalized.type}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Time: </b>${formatTime(elapsedTime)}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Pace: </b>${convertMphToPace(averageSpeedMph)}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Pace: </b>${convertMphToPace(maxSpeedMph)}</h3></div>`;
        }

        if (normalized.type === 'Ride') {
            return title + date + ownerMarkup
                + `<h3><b> Workout: </b>${normalized.type}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Time: </b>${(elapsedTime / 3600).toFixed(2)} hours</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>${averageSpeedMph.toFixed(2)} mph</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Speed: </b>${maxSpeedMph.toFixed(2)} mph</h3></div>`;
        }

        if (normalized.type === 'Swim') {
            return title + date + ownerMarkup
                + `<h3><b> Workout: </b>${normalized.type}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Time: </b>${(elapsedTime / 3600).toFixed(2)} hours</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Strokes Per Min: </b>${normalized.average_cadence}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>${averageSpeedMph.toFixed(2)} mph</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Speed: </b>${maxSpeedMph.toFixed(2)} mph</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Laps Per Minute: </b>${((Number(normalized.average_speed || 0) * 60) / 25).toFixed(1)}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Laps Per Minute: </b>${((Number(normalized.max_speed || 0) * 60) / 25).toFixed(1)}</h3></div>`;
        }

        if (normalized.type === 'AlpineSki' || normalized.type === 'BackcountrySki' || normalized.type === 'NordicSki' || normalized.type === 'Snowboard') {
            return title + date + ownerMarkup
                + `<h3><b> Workout: </b>${normalized.type}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Time: </b>${(elapsedTime / 3600).toFixed(2)} hours</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>${averageSpeedMph.toFixed(2)} mph</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Speed: </b>${maxSpeedMph.toFixed(2)} mph</h3></div>`;
        }

        if (normalized.type === 'Golf') {
            return title + date + ownerMarkup
                + `<h3><b> Workout: </b>${normalized.type}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Time: </b>${(elapsedTime / 3600).toFixed(2)} hours</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Speed: </b>${averageSpeedMph.toFixed(2)} mph</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Speed: </b>${maxSpeedMph.toFixed(2)} mph</h3></div>`;
        }

        if (normalized.type === 'Walk') {
            return title + date + ownerMarkup
                + `<h3 style='margin-top: -5px;'><b> Workout: </b>${normalized.type}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Time: </b>${formatTime(elapsedTime)}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Avg. Pace: </b>${convertMphToPace(averageSpeedMph)}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Max Pace: </b>${convertMphToPace(maxSpeedMph)}</h3>`
                + `<h3 style='margin-top: -5px;'><b> Elevation Gain: </b>${elevationGainFeet} feet</h3></div>`;
        }

        return title + date + ownerMarkup
            + `<h3 style='margin-top: -5px;'><b> Workout: </b>${normalized.type}</h3>`
            + `<h3 style='margin-top: -5px;'><b> Distance: </b>${distance}</h3>`
            + `<h3 style='margin-top: -5px;'><b> Time: </b>${formatTime(elapsedTime)}</h3>`
            + `<h3 style='margin-top: -5px;'><b> Avg. Pace: </b>${convertMphToPace(averageSpeedMph)}</h3>`
            + `<h3 style='margin-top: -5px;'><b> Max Pace: </b>${convertMphToPace(maxSpeedMph)}</h3></div>`;
    }

    function getActivityKey(activity) {
        const normalized = normalizeActivityRecord(activity);
        return String(normalized.id || `${normalized.name}-${normalized.start_date}`);
    }

    function createActivityDescriptor(activity, options) {
        const normalized = normalizeActivityRecord(activity);
        const coordinates = getActivityRouteCoordinates(normalized);
        if (!coordinates.length) {
            return null;
        }
        const opts = options || {};
        const lineStyle = getLineStyle();
        const style = {
            color: opts.color || getActivityColor(normalized),
            weight: getActivityLineWeight(normalized, typeof opts.lineWeight === 'number' ? opts.lineWeight : lineStyle.LINE_WEIGHT),
            opacity: getActivityLineOpacity(normalized, typeof opts.opacityWeight === 'number' ? opts.opacityWeight : lineStyle.OPACITY_WEIGHT),
            lineCap: 'round',
            lineJoin: 'round'
        };
        return {
            activity: normalized,
            coordinates: coordinates,
            renderCoordinates: getMapRenderRouteCoordinates(coordinates),
            style: style,
            tooltipHtml: buildTooltip(normalized, { ownerName: opts.ownerName || '' }),
            meta: {
                activityKey: getActivityKey(normalized),
                type: normalizeActivityType(normalized),
                date: String(normalized.start_date || '').split('T')[0],
                user: opts.userSlug || normalized.user_slug || '',
                ownerName: opts.ownerName || '',
                color: style.color
            }
        };
    }

    function getLayerFullBounds(layer) {
        if (layer && layer._stravaDescriptor && Array.isArray(layer._stravaDescriptor.coordinates) && layer._stravaDescriptor.coordinates.length) {
            return window.L.latLngBounds(layer._stravaDescriptor.coordinates);
        }
        return layer && typeof layer.getBounds === 'function' ? layer.getBounds() : null;
    }

    function registerPolyline(map, layer, descriptor) {
        if (!map._stravaPolylines) {
            map._stravaPolylines = [];
        }
        layer._stravaMeta = descriptor.meta;
        layer._stravaDescriptor = descriptor;
        map._stravaPolylines.push(layer);
        return layer;
    }

    function bringOverlayGroupToFront(layer) {
        if (!layer || !layer._speedOverlayGroup) {
            return;
        }
        layer._speedOverlayGroup.eachLayer(function (segment) {
            if (typeof segment.bringToFront === 'function') {
                segment.bringToFront();
            }
        });
    }

    function setSpeedOverlayHoverState(layer, hovered) {
        if (!layer || !layer._speedOverlayGroup || !layer._speedOverlayStyle) {
            return false;
        }
        const overlayStyle = layer._speedOverlayStyle;
        layer._speedOverlayGroup.eachLayer(function (segment) {
            segment.setStyle({
                weight: hovered ? overlayStyle.hoverWeight : overlayStyle.weight,
                opacity: hovered ? overlayStyle.hoverOpacity : overlayStyle.opacity
            });
        });
        layer.setStyle({
            color: overlayStyle.baseColor,
            weight: hovered ? overlayStyle.baseHoverWeight : overlayStyle.baseWeight,
            opacity: overlayStyle.baseOpacity
        });
        if (hovered) {
            bringOverlayGroupToFront(layer);
        }
        return true;
    }

    function applyHoverHandlers(layer, baseStyle) {
        layer.on('mouseover', function () {
            if (typeof layer.openTooltip === 'function') {
                layer.openTooltip();
            }
            if (setSpeedOverlayHoverState(layer, true)) {
                return;
            }
            if (typeof layer.bringToFront === 'function') {
                layer.bringToFront();
            }
            layer.setStyle({ weight: 15, opacity: 0.5 });
        });
        layer.on('mouseout', function () {
            if (typeof layer.closeTooltip === 'function') {
                layer.closeTooltip();
            }
            if (setSpeedOverlayHoverState(layer, false)) {
                return;
            }
            layer.setStyle({ weight: baseStyle.weight, opacity: baseStyle.opacity });
        });
    }

    function createPolylineLayer(map, descriptor, latLngs) {
        const routeStyle = Object.assign({}, descriptor.style);
        if (map && map._stravaRouteRenderer) {
            routeStyle.renderer = map._stravaRouteRenderer;
        }
        const layer = window.L.polyline(latLngs || descriptor.renderCoordinates || descriptor.coordinates, routeStyle).addTo(map);
        layer.bindTooltip(descriptor.tooltipHtml, Object.assign({}, TOOLTIP_OPTIONS, descriptor.tooltipOptions || {}));
        applyHoverHandlers(layer, descriptor.style);
        registerPolyline(map, layer, descriptor);
        return layer;
    }

    function renderActivityDescriptor(map, descriptor) {
        return createPolylineLayer(map, descriptor, descriptor.renderCoordinates || descriptor.coordinates);
    }

    function renderActivityDescriptors(map, descriptors) {
        return (descriptors || []).map(function (descriptor) {
            return renderActivityDescriptor(map, descriptor);
        });
    }

    function createHttpError(method, path, response) {
        const error = new Error(`${method} ${path} failed with ${response.status}`);
        error.status = response.status;
        error.path = path;
        error.method = method;
        error.isHttpError = true;
        return error;
    }

    function createTimeoutError(method, path, timeoutMs) {
        const error = new Error(`${method} ${path} timed out after ${timeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        error.isTimeout = true;
        error.path = path;
        error.method = method;
        return error;
    }

    function fetchJsonWithTimeout(url, fetchOptions, requestMeta) {
        const options = Object.assign({}, fetchOptions || {});
        const timeoutMs = Number(options.timeoutMs) || 0;
        delete options.timeoutMs;
        let timeoutId = null;
        let controller = null;
        if (timeoutMs > 0 && typeof window.AbortController === 'function') {
            controller = new window.AbortController();
            options.signal = controller.signal;
            timeoutId = window.setTimeout(function () {
                controller.abort();
            }, timeoutMs);
        }
        return window.fetch(url, options).catch(function (error) {
            if (error && error.name === 'AbortError') {
                throw createTimeoutError(requestMeta.method, requestMeta.path, timeoutMs);
            }
            throw error;
        }).finally(function () {
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        });
    }

    function apiGet(apiBase, path, params, requestOptions) {
        const base = apiBase || '';
        const url = new URL(`${base}${path}`, window.location.origin);
        Object.entries(params || {}).forEach(function (entry) {
            if (entry[1] !== undefined && entry[1] !== null && entry[1] !== '') {
                url.searchParams.set(entry[0], entry[1]);
            }
        });
        return fetchJsonWithTimeout(url.toString(), requestOptions, { method: 'GET', path: path }).then(function (response) {
            if (!response.ok) {
                throw createHttpError('GET', path, response);
            }
            return response.json();
        });
    }

    function apiPost(apiBase, path, body, requestOptions) {
        const base = apiBase || '';
        return fetchJsonWithTimeout(`${base}${path}`, Object.assign({
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body || {})
        }, requestOptions || {}), { method: 'POST', path: path }).then(function (response) {
            if (!response.ok) {
                throw createHttpError('POST', path, response);
            }
            return response.json();
        });
    }

    function apiPatch(apiBase, path, body, requestOptions) {
        const base = apiBase || '';
        return fetchJsonWithTimeout(`${base}${path}`, Object.assign({
            method: 'PATCH',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body || {})
        }, requestOptions || {}), { method: 'PATCH', path: path }).then(function (response) {
            if (!response.ok) {
                throw createHttpError('PATCH', path, response);
            }
            return response.json();
        });
    }

    function apiDelete(apiBase, path, params, requestOptions) {
        const base = apiBase || '';
        const url = new URL(`${base}${path}`, window.location.origin);
        Object.entries(params || {}).forEach(function (entry) {
            if (entry[1] !== undefined && entry[1] !== null && entry[1] !== '') {
                url.searchParams.set(entry[0], entry[1]);
            }
        });
        return fetchJsonWithTimeout(url.toString(), Object.assign({
            method: 'DELETE',
            headers: {
                Accept: 'application/json, text/plain, */*'
            }
        }, requestOptions || {}), { method: 'DELETE', path: path }).then(function (response) {
            if (!response.ok) {
                throw createHttpError('DELETE', path, response);
            }
            return response.json();
        });
    }

    function shouldFallbackForBackendError(error) {
        if (!error) {
            return false;
        }
        if (error.isTimeout || error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
            return true;
        }
        if (error.name === 'TypeError' || error instanceof TypeError) {
            return true;
        }
        const status = Number(error.status);
        if (!Number.isFinite(status)) {
            return false;
        }
        if (status === 429 || status >= 500) {
            return true;
        }
        if (status >= 400 && status < 500) {
            return true;
        }
        return false;
    }

    function formatBackendFallbackReason(label, error) {
        const status = Number(error && error.status);
        if (Number.isFinite(status)) {
            return `${label} backend failed with ${status}`;
        }
        if (error && error.isTimeout) {
            return `${label} backend timed out`;
        }
        if (error && error.message) {
            return `${label}: ${error.message}`;
        }
        return `${label} backend unavailable`;
    }

    function createRuntimeDataSource(options) {
        const opts = options || {};
        const apiBase = opts.apiBase || '';
        const cooldownMs = Number(opts.cooldownMs) || 300000;
        const isLocalApiBase = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(apiBase);
        const allowDirectFallback = opts.allowDirectFallback !== false;
        const rememberBackendFailures = opts.rememberBackendFailures === true;
        const requestTimeoutMs = Number(opts.requestTimeoutMs) || (isLocalApiBase ? 600000 : 30000);
        const disabledUntilKey = opts.disabledUntilKey || 'strava_backend_disabled_until';
        const disabledReasonKey = opts.disabledReasonKey || 'strava_backend_disabled_reason';
        const storage = window.sessionStorage;
        let fallbackReason = '';
        let mode = apiBase ? 'backend' : 'direct';

        function readDisabledUntil() {
            if (!storage) {
                return 0;
            }
            const rawValue = storage.getItem(disabledUntilKey);
            const parsed = Number(rawValue || 0);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function clearDisabledState() {
            if (!storage) {
                return;
            }
            storage.removeItem(disabledUntilKey);
            storage.removeItem(disabledReasonKey);
        }

        function persistDisabledState(reason) {
            if (!rememberBackendFailures || !storage || !apiBase || isLocalApiBase) {
                return;
            }
            storage.setItem(disabledUntilKey, String(Date.now() + cooldownMs));
            storage.setItem(disabledReasonKey, reason || 'Backend unavailable');
        }

        function dispatchFallbackEvent(reason, label) {
            if (!apiBase) {
                return;
            }
            window.dispatchEvent(new window.CustomEvent('strava:backend-fallback', {
                detail: {
                    apiBase: apiBase,
                    label: label,
                    reason: reason
                }
            }));
        }

        if (apiBase && !isLocalApiBase && !rememberBackendFailures) {
            clearDisabledState();
        }

        if (apiBase && !isLocalApiBase && allowDirectFallback && rememberBackendFailures) {
            const disabledUntil = readDisabledUntil();
            if (disabledUntil > Date.now()) {
                mode = 'direct';
                fallbackReason = (storage && storage.getItem(disabledReasonKey)) || 'Backend temporarily disabled';
            } else if (disabledUntil) {
                clearDisabledState();
            }
        }

        function getMode() {
            return mode;
        }

        function isBackendEnabled() {
            return Boolean(apiBase) && mode === 'backend';
        }

        function getFallbackReason() {
            return fallbackReason;
        }

        function disableBackend(reason) {
            if (!apiBase) {
                return;
            }
            fallbackReason = reason || 'Backend unavailable';
            if (!allowDirectFallback) {
                dispatchFallbackEvent(fallbackReason, 'manual');
                return;
            }
            mode = 'direct';
            persistDisabledState(fallbackReason);
            dispatchFallbackEvent(fallbackReason, 'manual');
        }

        function runWithFallback(label, backendFn, fallbackFn) {
            if (!isBackendEnabled()) {
                if (!allowDirectFallback && apiBase) {
                    return Promise.reject(new Error(getFallbackReason() || 'Backend API is unavailable.'));
                }
                return Promise.resolve().then(function () {
                    return fallbackFn();
                });
            }
            return Promise.resolve().then(function () {
                return backendFn({ timeoutMs: requestTimeoutMs });
            }).catch(function (error) {
                if (!fallbackFn || !allowDirectFallback || !shouldFallbackForBackendError(error)) {
                    throw error;
                }
                fallbackReason = formatBackendFallbackReason(label, error);
                mode = 'direct';
                persistDisabledState(fallbackReason);
                dispatchFallbackEvent(fallbackReason, label);
                return fallbackFn(error);
            });
        }

        return {
            getMode: getMode,
            isBackendEnabled: isBackendEnabled,
            runWithFallback: runWithFallback,
            disableBackend: disableBackend,
            getFallbackReason: getFallbackReason,
            apiBase: apiBase,
            requestTimeoutMs: requestTimeoutMs
        };
    }

    function logDataLoadSummary(details) {
        const payload = Object.assign({}, details || {});
        if (payload.recordsPulled !== undefined) {
            payload.recordsPulled = Number(payload.recordsPulled) || 0;
        }
        if (payload.recordsUpdated !== undefined) {
            payload.recordsUpdated = Number(payload.recordsUpdated) || 0;
        }
        if (payload.stravaRecordsPulled !== undefined) {
            payload.stravaRecordsPulled = Number(payload.stravaRecordsPulled) || 0;
        }
        if (payload.stravaSummaryFetchedCount !== undefined) {
            payload.stravaSummaryFetchedCount = Number(payload.stravaSummaryFetchedCount) || 0;
        }
        if (payload.stravaDetailFetchedCount !== undefined) {
            payload.stravaDetailFetchedCount = Number(payload.stravaDetailFetchedCount) || 0;
        }
        if (payload.recordsInserted !== undefined) {
            payload.recordsInserted = Number(payload.recordsInserted) || 0;
        }
        console.log('[Strava Data]', payload);
    }

    function buildStravaUrl(path, params) {
        const url = new URL(`${STRAVA_API_BASE_URL}${path}`);
        Object.entries(params || {}).forEach(function (entry) {
            if (entry[1] !== undefined && entry[1] !== null && entry[1] !== '') {
                url.searchParams.set(entry[0], entry[1]);
            }
        });
        return url;
    }

    function stravaFetchJson(path, accessToken, params) {
        const url = buildStravaUrl(path, params);
        return window.fetch(url.toString(), {
            headers: {
                Accept: 'application/json, text/plain, */*',
                Authorization: `Bearer ${accessToken}`
            }
        }).then(function (response) {
            if (!response.ok) {
                throw new Error(`Strava request failed with ${response.status}`);
            }
            return response.json();
        });
    }

    function stravaReAuthorize(config) {
        return window.fetch(STRAVA_AUTH_URL, {
            method: 'post',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: String(config.clientId),
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken,
                grant_type: 'refresh_token'
            })
        }).then(function (response) {
            if (!response.ok) {
                throw new Error(`Strava authorization failed with ${response.status}`);
            }
            return response.json();
        });
    }

    function stravaFetchActivity(accessToken, activityId) {
        return stravaFetchJson(`/activities/${activityId}`, accessToken).then(normalizeActivityRecord);
    }

    function normalizeStreamKeys(keys) {
        const values = Array.isArray(keys) ? keys : String(keys || '').split(',');
        const normalized = [];
        values.forEach(function (value) {
            const key = String(value || '').trim();
            if (STRAVA_STREAM_REGISTRY[key] && normalized.indexOf(key) === -1) {
                normalized.push(key);
            }
        });
        return normalized;
    }

    function getStreamKeysForProfile(profile) {
        const profileId = String(profile || 'speed').trim();
        return (STRAVA_STREAM_PROFILES[profileId] || STRAVA_STREAM_PROFILES.speed).slice();
    }

    function normalizeStreamRequestOptions(options) {
        const opts = options || {};
        const explicitKeys = normalizeStreamKeys(opts.keys);
        const keys = explicitKeys.length ? explicitKeys : getStreamKeysForProfile(opts.profile || 'speed');
        return {
            keys: keys,
            resolution: opts.resolution || 'high',
            seriesType: opts.seriesType || opts.series_type || 'time'
        };
    }

    function extractStreamValues(streamData, key) {
        const stream = streamData && streamData[key];
        if (stream && Array.isArray(stream.data)) {
            return stream.data;
        }
        return Array.isArray(stream) ? stream : [];
    }

    function stravaFetchActivityStreams(accessToken, activityId, options) {
        const opts = normalizeStreamRequestOptions(options);
        return stravaFetchJson(`/activities/${activityId}/streams`, accessToken, {
            keys: opts.keys.join(','),
            key_by_type: 'true',
            resolution: opts.resolution,
            series_type: opts.seriesType
        }).then(function (streamData) {
            const streams = {};
            Object.keys(STRAVA_STREAM_REGISTRY).forEach(function (key) {
                const values = extractStreamValues(streamData, key);
                if (values.length) {
                    streams[key] = values;
                }
            });
            return {
                streams: streams,
                latlng: streams.latlng || [],
                velocity_smooth: streams.velocity_smooth || [],
                time: streams.time || [],
                stream_requested_keys: opts.keys,
                stream_keys: Object.keys(streams),
                resolution: opts.resolution,
                series_type: opts.seriesType
            };
        });
    }

    async function stravaFetchActivities(accessToken, pages) {
        const activities = [];
        for (let page = 1; page <= pages; page += 1) {
            const response = await window.fetch(`${STRAVA_ACTIVITIES_URL}?access_token=${accessToken}&per_page=200&page=${page}`);
            if (!response.ok) {
                throw new Error(`Strava activities fetch failed with ${response.status}`);
            }
            const data = await response.json();
            if (!Array.isArray(data) || !data.length) {
                break;
            }
            activities.push.apply(activities, data.map(normalizeActivityRecord));
            if (data.length < 200) {
                break;
            }
        }
        return sortActivitiesNewestFirst(activities);
    }

    async function stravaGetLatestLocation(accessToken, fallback) {
        try {
            const response = await window.fetch(`${STRAVA_ACTIVITIES_URL}?access_token=${accessToken}&per_page=1&page=1`);
            if (!response.ok) {
                throw new Error(`Strava latest location failed with ${response.status}`);
            }
            const data = await response.json();
            const latest = Array.isArray(data) ? data[0] : null;
            if (latest && Array.isArray(latest.start_latlng) && latest.start_latlng.length === 2) {
                return latest.start_latlng;
            }
        } catch (error) {
            console.warn('Using fallback centre:', error);
        }
        return fallback;
    }

    function normalizeMapTheme(theme) {
        return String(theme || '').toLowerCase() === 'dark' ? 'dark' : 'light';
    }

    function getMapStyleUrl(theme) {
        return normalizeMapTheme(theme) === 'dark' ? MAPBOX_DARK_STYLE_URL : MAPBOX_LIGHT_STYLE_URL;
    }

    function getMapAccessToken(theme) {
        return normalizeMapTheme(theme) === 'dark' ? MAPBOX_DARK_ACCESS_TOKEN : MAPBOX_ACCESS_TOKEN;
    }

    function getLeafletTileStyleUrl(styleUrl) {
        const rawStyleUrl = String(styleUrl || '').trim();
        const mapboxMatch = rawStyleUrl.match(/^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)$/i);
        if (mapboxMatch) {
            return `https://api.mapbox.com/styles/v1/${mapboxMatch[1]}/${mapboxMatch[2]}/tiles/512/{z}/{x}/{y}?access_token={accessToken}`;
        }
        return rawStyleUrl;
    }

    function createBaseTileLayer(theme, options) {
        const opts = options || {};
        const normalizedTheme = normalizeMapTheme(theme);
        const accessToken = opts.accessToken || getMapAccessToken(normalizedTheme);
        const styleUrl = getLeafletTileStyleUrl(opts.tileUrl || opts.styleUrl || getMapStyleUrl(normalizedTheme)).replace('{accessToken}', accessToken);
        return window.L.tileLayer(styleUrl, {
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery &copy; <a href="https://www.mapbox.com/">Mapbox</a>',
            maxZoom: 30,
            id: 'mapbox/streets-v11',
            tileSize: 512,
            zoomOffset: -1,
            accessToken: accessToken
        });
    }

    function initMap(elementId, center, zoom, options) {
        const opts = options || {};
        const theme = normalizeMapTheme(opts.theme);
        const map = window.L.map(elementId).setView(center, typeof zoom === 'number' ? zoom : 8);
        function handleResize() {
            const container = typeof map.getContainer === 'function' ? map.getContainer() : null;
            if (!container || !container.parentNode || !map._mapPane) {
                return;
            }
            map.invalidateSize();
        }
        window.addEventListener('resize', handleResize);
        map.once('unload', function () {
            window.removeEventListener('resize', handleResize);
        });
        map._stravaBaseTheme = theme;
        map._stravaBaseTileLayer = createBaseTileLayer(theme, {
            styleUrl: opts.styleUrl,
            tileUrl: opts.tileUrl,
            accessToken: opts.accessToken
        });
        map._stravaBaseTileLayer.on('tileerror', function (event) {
            console.warn('Mapbox tile failed to load', {
                theme: map._stravaBaseTheme,
                url: event && event.tile ? event.tile.src : ''
            });
        });
        map._stravaBaseTileLayer.addTo(map);
        map._stravaPolylines = [];
        if (window.L.canvas) {
            map._stravaRouteRenderer = window.L.canvas({
                padding: 0.5,
                tolerance: window.innerWidth <= 900 ? 18 : 12
            });
        }
        return map;
    }

    function setMapTheme(map, theme) {
        if (!map) {
            return null;
        }
        const normalizedTheme = normalizeMapTheme(theme);
        if (map._stravaBaseTheme === normalizedTheme && map._stravaBaseTileLayer) {
            return map._stravaBaseTileLayer;
        }
        if (map._stravaBaseTileLayer && map.hasLayer(map._stravaBaseTileLayer)) {
            map.removeLayer(map._stravaBaseTileLayer);
        }
        map._stravaBaseTheme = normalizedTheme;
        map._stravaBaseTileLayer = createBaseTileLayer(normalizedTheme);
        map._stravaBaseTileLayer.on('tileerror', function (event) {
            console.warn('Mapbox tile failed to load', {
                theme: map._stravaBaseTheme,
                url: event && event.tile ? event.tile.src : ''
            });
        });
        map._stravaBaseTileLayer.addTo(map);
        return map._stravaBaseTileLayer;
    }

    function flyIn(map, center) {
        return new Promise(function (resolve) {
            window.setTimeout(function () {
                map.once('moveend', resolve);
                map.flyTo(center, 13, { animate: true, duration: 1.95 });
            }, 3200);
        });
    }

    function setupSplashScreen(options) {
        const opts = options || {};
        const preload = document.getElementById(opts.preloadId || 'preload');
        const splash = document.getElementById(opts.splashId || 'splash');
        const splashText = document.getElementById(opts.splashTextId || 'splash-text');
        const date = new Date();
        if (splashText) {
            splashText.textContent = `${date.toLocaleDateString(undefined, { weekday: 'long' })}, ${date.toLocaleDateString(undefined, { month: 'long' })} ${ordinal(date.getDate())} ${date.getFullYear()}`;
        }
        window.addEventListener('load', function () {
            if (preload) {
                preload.classList.add('fade');
            }
            window.setTimeout(function () {
                window.setTimeout(function () {
                    if (splash) {
                        splash.classList.add('fade-out');
                    }
                }, 2000);
            }, 500);
        });
        return { preload: preload, splash: splash, splashText: splashText };
    }

    function sortActivitiesNewestFirst(activities) {
        return (activities || []).slice().sort(function (left, right) {
            return new Date(right.start_date).getTime() - new Date(left.start_date).getTime();
        });
    }

    function getDetectedTypes(activities) {
        return Array.from(new Set((activities || []).map(function (activity) {
            return normalizeActivityType(activity);
        }).filter(Boolean))).sort(function (left, right) {
            return getActivityLabel(left).localeCompare(getActivityLabel(right));
        });
    }

    function matchesFilters(activity, filters) {
        const normalized = normalizeActivityRecord(activity);
        const type = normalizeActivityType(normalized);
        const date = String(normalized.start_date || '').split('T')[0];
        const activeTypes = filters && filters.types ? new Set(Array.from(filters.types).map(function (value) { return String(value).toLowerCase(); })) : null;
        const activeUsers = filters && filters.users ? new Set(Array.from(filters.users).map(function (value) { return String(value).toLowerCase(); })) : null;
        const userSlug = String((filters && filters.userSlugOverride) || normalized.user_slug || '').toLowerCase();

        if (activeTypes && activeTypes.size && !activeTypes.has(type)) {
            return false;
        }
        if (filters && filters.dateFrom && date < filters.dateFrom) {
            return false;
        }
        if (filters && filters.dateTo && date > filters.dateTo) {
            return false;
        }
        if (activeUsers && activeUsers.size && userSlug && !activeUsers.has(userSlug)) {
            return false;
        }
        return true;
    }

    function filterActivities(activities, filters, userSlug) {
        return (activities || []).filter(function (activity) {
            return matchesFilters(activity, Object.assign({}, filters, { userSlugOverride: userSlug || activity.user_slug || '' }));
        });
    }

    function applyFilters(map, filters) {
        const visibleLayers = [];
        (map._stravaPolylines || []).forEach(function (layer) {
            const meta = layer._stravaMeta || {};
            const activeTypes = filters && filters.types ? new Set(Array.from(filters.types).map(function (value) { return String(value).toLowerCase(); })) : null;
            const activeUsers = filters && filters.users ? new Set(Array.from(filters.users).map(function (value) { return String(value).toLowerCase(); })) : null;
            let visible = true;
            if (activeTypes && activeTypes.size && !activeTypes.has(String(meta.type || '').toLowerCase())) {
                visible = false;
            }
            if (visible && filters && filters.dateFrom && meta.date < filters.dateFrom) {
                visible = false;
            }
            if (visible && filters && filters.dateTo && meta.date > filters.dateTo) {
                visible = false;
            }
            if (visible && activeUsers && activeUsers.size && meta.user && !activeUsers.has(String(meta.user).toLowerCase())) {
                visible = false;
            }
            if (visible) {
                if (!map.hasLayer(layer)) {
                    layer.addTo(map);
                }
                visibleLayers.push(layer);
            } else if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        });
        return visibleLayers;
    }

    function getBoundsFromLayers(layers) {
        if (!(layers || []).length) {
            return null;
        }
        const bounds = window.L.latLngBounds([]);
        (layers || []).forEach(function (layer) {
            const layerBounds = getLayerFullBounds(layer);
            if (layerBounds && layerBounds.isValid && layerBounds.isValid()) {
                bounds.extend(layerBounds);
            }
        });
        return bounds;
    }

    function fitMapToLayers(map, layers, options) {
        const bounds = getBoundsFromLayers(layers);
        if (!bounds || !bounds.isValid()) {
            return;
        }
        map.fitBounds(bounds, Object.assign({ padding: [30, 30], maxZoom: 12 }, options || {}));
    }

    function getMetricValue(activity, metric) {
        const normalized = normalizeActivityRecord(activity);
        if (metric === 'time') {
            return Number(normalized.elapsed_time || 0);
        }
        if (metric === 'count') {
            return 1;
        }
        if (metric === 'elevation') {
            return Number(normalized.total_elevation_gain || 0) * 3.28084;
        }
        return getMiles(Number(normalized.distance || 0));
    }

    function formatMetricValue(value, metric) {
        if (metric === 'time') {
            return formatTime(Math.round(value || 0));
        }
        if (metric === 'count') {
            return String(Math.round(value || 0));
        }
        if (metric === 'elevation') {
            return `${Number(value || 0).toFixed(0)} ft`;
        }
        return `${Number(value || 0).toFixed(2)} mi`;
    }

    window.StravaApp = {
        USER_CONFIGS: USER_CONFIGS,
        SUMMARY_LABEL_MAP: SUMMARY_LABEL_MAP,
        SUMMARY_COLOR_MAP: SUMMARY_COLOR_MAP,
        ACTIVITY_COLOR_MAP: ACTIVITY_COLOR_MAP,
        STRAVA_STREAM_REGISTRY: STRAVA_STREAM_REGISTRY,
        STRAVA_STREAM_PROFILES: STRAVA_STREAM_PROFILES,
        ROUTE_SMOOTHING_CONFIG: ROUTE_SMOOTHING_CONFIG,
        TOOLTIP_OPTIONS: TOOLTIP_OPTIONS,
        STRAVA_AUTH_URL: STRAVA_AUTH_URL,
        STRAVA_ACTIVITIES_URL: STRAVA_ACTIVITIES_URL,
        getMiles: getMiles,
        formatTime: formatTime,
        convertMphToPace: convertMphToPace,
        parseDateValue: parseDateValue,
        formatDate: formatDate,
        formatClockTime: formatClockTime,
        normalizeActivityType: normalizeActivityType,
        normalizeActivityRecord: normalizeActivityRecord,
        getActivityLabel: getActivityLabel,
        normalizeHexColor: normalizeHexColor,
        getDefaultActivityColor: getDefaultActivityColor,
        getActivityColor: getActivityColor,
        normalizeLineThickness: normalizeLineThickness,
        normalizeLineOpacity: normalizeLineOpacity,
        normalizeAnimationSpeedMultiplier: normalizeAnimationSpeedMultiplier,
        getActivityLineWeight: getActivityLineWeight,
        getActivityLineOpacity: getActivityLineOpacity,
        getActivityAnimationSpeedMultiplier: getActivityAnimationSpeedMultiplier,
        getLineStyle: getLineStyle,
        decodePolyline: decodePolyline,
        normalizeRouteCoordinates: normalizeRouteCoordinates,
        getMapRenderRouteCoordinates: getMapRenderRouteCoordinates,
        smoothRouteCoordinates: smoothRouteCoordinates,
        getActivityRouteCoordinates: getActivityRouteCoordinates,
        createDataAccumulator: createDataAccumulator,
        drawMilesChart: drawMilesChart,
        drawSummaryChart: drawSummaryChart,
        drawComparisonChart: drawComparisonChart,
        buildTooltip: buildTooltip,
        createActivityDescriptor: createActivityDescriptor,
        createPolylineLayer: createPolylineLayer,
        renderActivityDescriptor: renderActivityDescriptor,
        renderActivityDescriptors: renderActivityDescriptors,
        registerPolyline: registerPolyline,
        applyHoverHandlers: applyHoverHandlers,
        applyFilters: applyFilters,
        filterActivities: filterActivities,
        createRuntimeDataSource: createRuntimeDataSource,
        logDataLoadSummary: logDataLoadSummary,
        apiGet: apiGet,
        apiPost: apiPost,
        apiPatch: apiPatch,
        apiDelete: apiDelete,
        normalizeStreamKeys: normalizeStreamKeys,
        getStreamKeysForProfile: getStreamKeysForProfile,
        normalizeStreamRequestOptions: normalizeStreamRequestOptions,
        stravaReAuthorize: stravaReAuthorize,
        stravaFetchActivity: stravaFetchActivity,
        stravaFetchActivityStreams: stravaFetchActivityStreams,
        stravaFetchActivities: stravaFetchActivities,
        stravaGetLatestLocation: stravaGetLatestLocation,
        initMap: initMap,
        setMapTheme: setMapTheme,
        flyIn: flyIn,
        setupSplashScreen: setupSplashScreen,
        sortActivitiesNewestFirst: sortActivitiesNewestFirst,
        getDetectedTypes: getDetectedTypes,
        fitMapToLayers: fitMapToLayers,
        getBoundsFromLayers: getBoundsFromLayers,
        getMetricValue: getMetricValue,
        formatMetricValue: formatMetricValue,
        getActivityKey: getActivityKey,
        wait: wait
    };
})(window);
