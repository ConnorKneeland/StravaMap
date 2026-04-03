(function (window) {
    'use strict';

    const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/token';
    const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
    const MAPBOX_STYLE_URL = 'https://api.mapbox.com/styles/v1/ckneeland/clczd9zd6001515pj5yvlalza/tiles/{z}/{x}/{y}?access_token={accessToken}';
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiY2tuZWVsYW5kIiwiYSI6ImNsY3pkNW8wdDAxcWozd21lMGhvczFuMHcifQ.GhhJgb3cpjIvHf8tz-gCFw';
    const MOBILE_REGEX = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    const TOOLTIP_OPTIONS = { permanent: false, sticky: true, className: 'left-align' };
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
        run: 'red',
        trailrun: 'red',
        virtualrun: 'red',
        ride: '#ff8000ff',
        mountainbikeride: '#ff8000ff',
        gravelride: '#ff8000ff',
        ebikeride: '#ff8000ff',
        emountainbikeride: '#ff8000ff',
        velomobile: '#ff8000ff',
        virtualride: '#ff8000ff',
        swim: '#1648ebff',
        walk: '#000000',
        alpineski: '#5f99cf',
        backcountryski: '#5f99cf',
        nordicski: '#5f99cf',
        snowboard: '#5f99cf',
        golf: '#0a7b0a',
        default: 'purple'
    };
    const USER_CONFIGS = {
        connor: { slug: 'connor', displayName: 'Connor', title: "Connor's Map", clientId: 162238, clientSecret: '526b6989b62616ce1416f27e0414866958666013', refreshToken: '23227cb9c49a632130451aa2206241479b6dd842', lat: 43.0722, lng: -89.4008, pages: 10, color: '#ff412e' },
        tim: { slug: 'tim', displayName: 'Tim', title: "Tim's Map", clientId: 100558, clientSecret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refreshToken: 'fd40d09e3d95895eda12334f5a6254db341ac516', lat: 44.4347, lng: -88.0679, pages: 30, color: '#ff8000ff' },
        quinn: { slug: 'quinn', displayName: 'Quinn', title: "Quinn's Map", clientId: 100558, clientSecret: 'dde52b1f1718be7fb8e2d3d0e75d7cbd8eac3910', refreshToken: '93bfb1298cb4e356053a8116127327d78a607608', lat: 43.034, lng: -87.912, pages: 10, color: '#1648ebff' },
        michael: { slug: 'michael', displayName: 'Michael', title: "Michael's Map", clientId: 162250, clientSecret: '730145084c5ba6dce48c112dee1156c426ee951c', refreshToken: 'b769e8affe3469c2acf39bfca5752ef06fea5f1d', lat: 44.43475, lng: -88.06789, pages: 10, color: '#0a7b0a' },
        mwelsh: { slug: 'mwelsh', displayName: 'Mwelsh', title: "Mwelsh's Map", clientId: 216000, clientSecret: '1cf9ccdbac63f92e3c62991df61b030bf1329f47', refreshToken: '6ce920762a92619324899932cca36fd33a90e119', lat: 43.0722, lng: -89.4008, pages: 5, color: '#8c564b' },
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

    function formatDate(dateString) {
        const date = new Date(dateString);
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const day = date.getDate();
        const monthIndex = date.getMonth();
        const year = date.getFullYear();
        const daySuffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
        return `${monthNames[monthIndex]} ${day}${daySuffix}, ${year}`;
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
        return { isMobile: isMobile, LINE_WEIGHT: isMobile ? 5 : 2.5, OPACITY_WEIGHT: isMobile ? 0.5 : 0.8 };
    }

    function normalizeActivityRecord(activity) {
        const normalized = Object.assign({}, activity);
        normalized.map = Object.assign({}, activity.map || {});
        if (!normalized.map.summary_polyline && normalized.summary_polyline) {
            normalized.map.summary_polyline = normalized.summary_polyline;
        }
        if (!normalized.start_latlng && activity.start_latlng) {
            normalized.start_latlng = activity.start_latlng;
        }
        if (!normalized.end_latlng && activity.end_latlng) {
            normalized.end_latlng = activity.end_latlng;
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

    function getActivityColor(activity) {
        const type = normalizeActivityType(activity);
        return ACTIVITY_COLOR_MAP[type] || ACTIVITY_COLOR_MAP.default;
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
        const ownerMarkup = ownerName ? `<h3 style='margin-top: -5px;'><b> Owner: </b>${ownerName}</h3>` : '';
        const title = `<div style='display: flex; align-items: flex-start; flex-direction: column;'><b style='font-size: 20px;'>${normalized.name}</b>`;
        const date = `<h2>On ${formatDate(normalized.start_date)}</h2>`;
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
        if (!normalized.map || !normalized.map.summary_polyline) {
            return null;
        }
        const coordinates = decodePolyline(normalized.map.summary_polyline);
        if (!coordinates.length) {
            return null;
        }
        const opts = options || {};
        const lineStyle = getLineStyle();
        const style = {
            color: opts.color || getActivityColor(normalized),
            weight: typeof opts.lineWeight === 'number' ? opts.lineWeight : lineStyle.LINE_WEIGHT,
            opacity: typeof opts.opacityWeight === 'number' ? opts.opacityWeight : lineStyle.OPACITY_WEIGHT,
            lineJoin: 'round'
        };
        return {
            activity: normalized,
            coordinates: coordinates,
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

    function registerPolyline(map, layer, descriptor) {
        if (!map._stravaPolylines) {
            map._stravaPolylines = [];
        }
        layer._stravaMeta = descriptor.meta;
        map._stravaPolylines.push(layer);
        return layer;
    }

    function applyHoverHandlers(layer, baseStyle) {
        layer.on('mouseover', function () {
            layer.setStyle({ weight: 15, opacity: 0.5 });
        });
        layer.on('mouseout', function () {
            layer.setStyle({ weight: baseStyle.weight, opacity: baseStyle.opacity });
        });
    }

    function createPolylineLayer(map, descriptor, latLngs) {
        const layer = window.L.polyline(latLngs || descriptor.coordinates, descriptor.style).addTo(map);
        layer.bindTooltip(descriptor.tooltipHtml, TOOLTIP_OPTIONS);
        applyHoverHandlers(layer, descriptor.style);
        registerPolyline(map, layer, descriptor);
        return layer;
    }

    function renderActivityDescriptor(map, descriptor) {
        return createPolylineLayer(map, descriptor, descriptor.coordinates);
    }

    function renderActivityDescriptors(map, descriptors) {
        return (descriptors || []).map(function (descriptor) {
            return renderActivityDescriptor(map, descriptor);
        });
    }

    function apiGet(apiBase, path, params) {
        const base = apiBase || '';
        const url = new URL(`${base}${path}`, window.location.origin);
        Object.entries(params || {}).forEach(function (entry) {
            if (entry[1] !== undefined && entry[1] !== null && entry[1] !== '') {
                url.searchParams.set(entry[0], entry[1]);
            }
        });
        return window.fetch(url.toString()).then(function (response) {
            if (!response.ok) {
                throw new Error(`GET ${path} failed with ${response.status}`);
            }
            return response.json();
        });
    }

    function apiPost(apiBase, path, body) {
        const base = apiBase || '';
        return window.fetch(`${base}${path}`, {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body || {})
        }).then(function (response) {
            if (!response.ok) {
                throw new Error(`POST ${path} failed with ${response.status}`);
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

    function initMap(elementId, center, zoom) {
        const map = window.L.map(elementId).setView(center, typeof zoom === 'number' ? zoom : 8);
        window.addEventListener('resize', function () {
            map.invalidateSize();
        });
        window.L.tileLayer(MAPBOX_STYLE_URL, {
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery &copy; <a href="https://www.mapbox.com/">Mapbox</a>',
            maxZoom: 30,
            id: 'mapbox/streets-v11',
            tileSize: 512,
            zoomOffset: -1,
            accessToken: MAPBOX_ACCESS_TOKEN
        }).addTo(map);
        map._stravaPolylines = [];
        return map;
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
            bounds.extend(layer.getBounds());
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
        TOOLTIP_OPTIONS: TOOLTIP_OPTIONS,
        STRAVA_AUTH_URL: STRAVA_AUTH_URL,
        STRAVA_ACTIVITIES_URL: STRAVA_ACTIVITIES_URL,
        getMiles: getMiles,
        formatTime: formatTime,
        convertMphToPace: convertMphToPace,
        formatDate: formatDate,
        normalizeActivityType: normalizeActivityType,
        normalizeActivityRecord: normalizeActivityRecord,
        getActivityLabel: getActivityLabel,
        getActivityColor: getActivityColor,
        getLineStyle: getLineStyle,
        decodePolyline: decodePolyline,
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
        apiGet: apiGet,
        apiPost: apiPost,
        stravaReAuthorize: stravaReAuthorize,
        stravaFetchActivities: stravaFetchActivities,
        stravaGetLatestLocation: stravaGetLatestLocation,
        initMap: initMap,
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
