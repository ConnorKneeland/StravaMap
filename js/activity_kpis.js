(function (root, factory) {
    'use strict';

    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./strava_activity_types'));
        return;
    }
    root.StravaActivityKpis = factory(root.StravaActivityTypes);
}(typeof self !== 'undefined' ? self : this, function (ActivityTypes) {
    'use strict';

    if (!ActivityTypes) {
        throw new Error('StravaActivityTypes is required by activity_kpis.js');
    }

    const SNAPSHOT_SCHEMA_VERSION = 2;
    const METERS_TO_MILES = 0.000621371192237334;
    const METERS_TO_FEET = 3.28083989501312;

    const METRIC_DEFINITIONS = Object.freeze({
        distance_meters: { label: 'Miles', totalLabel: 'Miles', kind: 'distance' },
        elapsed_time_seconds: { label: 'Time', totalLabel: 'Time', kind: 'time' },
        moving_time_seconds: { label: 'Moving Time', totalLabel: 'Moving Time', kind: 'time' },
        elevation_gain_meters: { label: 'Elevation', totalLabel: 'Elevation', kind: 'elevation' },
        calories: { label: 'Calories', totalLabel: 'Calories', singular: 'Calorie', plural: 'Calories', kind: 'count' },
        lap_count: { label: 'Laps', totalLabel: 'Laps', singular: 'Lap', plural: 'Laps', kind: 'count' },
        length_count: { label: 'Lengths', totalLabel: 'Lengths', singular: 'Length', plural: 'Lengths', kind: 'count' },
        stroke_count: { label: 'Strokes', totalLabel: 'Strokes', singular: 'Stroke', plural: 'Strokes', kind: 'count' },
        ski_run_count: { label: 'Runs', totalLabel: 'Runs', singular: 'Run', plural: 'Runs', kind: 'count' },
        set_count: { label: 'Sets', totalLabel: 'Sets', singular: 'Set', plural: 'Sets', kind: 'count' },
        repetition_count: { label: 'Reps', totalLabel: 'Reps', singular: 'Rep', plural: 'Reps', kind: 'count' },
        floor_count: { label: 'Floors', totalLabel: 'Floors', singular: 'Floor', plural: 'Floors', kind: 'count' },
        hole_count: { label: 'Holes', totalLabel: 'Holes', singular: 'Hole', plural: 'Holes', kind: 'count' },
        game_count: { label: 'Games', totalLabel: 'Games', singular: 'Game', plural: 'Games', kind: 'count' },
        wave_count: { label: 'Waves', totalLabel: 'Waves', singular: 'Wave', plural: 'Waves', kind: 'count' },
        tack_count: { label: 'Tacks', totalLabel: 'Tacks', singular: 'Tack', plural: 'Tacks', kind: 'count' }
    });

    const ELEVATION_TYPES = new Set([
        'run', 'trailrun', 'walk', 'hike', 'ride', 'gravelride', 'mountainbikeride',
        'ebikeride', 'emountainbikeride', 'handcycle', 'velomobile', 'wheelchair',
        'iceskate', 'inlineskate', 'rollerski', 'skateboard', 'snowshoe', 'rockclimb',
        'virtualrun', 'virtualride'
    ]);
    const DOWNHILL_SNOW_TYPES = new Set(['alpineski', 'backcountryski', 'snowboard']);
    const PADDLE_TYPES = new Set(['rowing', 'virtualrow', 'kayak', 'canoe', 'standuppaddling']);
    const STRENGTH_TYPES = new Set(['weighttraining', 'crossfit', 'hiit', 'workout']);
    const MACHINE_TYPES = new Set(['stairstepper', 'elliptical']);
    const TEAM_RACKET_TYPES = new Set([
        'badminton', 'basketball', 'cricket', 'padel', 'pickleball', 'racquetball',
        'soccer', 'squash', 'tabletennis', 'tennis', 'volleyball'
    ]);
    const WELLNESS_TYPES = new Set(['yoga', 'pilates', 'physicaltherapy', 'dance']);
    const SAIL_TYPES = new Set(['sail', 'windsurf', 'kitesurf']);
    const MOBILE_COUNT_UNITS = Object.freeze({
        calories: ['cal', 'cal'],
        lap_count: ['lap', 'laps'],
        length_count: ['len', 'len'],
        stroke_count: ['stk', 'stk'],
        ski_run_count: ['run', 'runs'],
        set_count: ['set', 'sets'],
        repetition_count: ['rep', 'reps'],
        floor_count: ['fl', 'fl'],
        hole_count: ['hole', 'holes'],
        game_count: ['gm', 'gm'],
        wave_count: ['wave', 'waves'],
        tack_count: ['tack', 'tacks']
    });
    const OTHER_ADDITIVE_COUNT_KEYS = [
        'length_count', 'stroke_count', 'ski_run_count', 'set_count',
        'repetition_count', 'floor_count', 'hole_count', 'game_count', 'wave_count', 'tack_count'
    ];

    function hasValue(value) {
        return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
    }

    function optionalNumber(value) {
        return hasValue(value) ? Number(value) : undefined;
    }

    function normalizedKind(value) {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    function firstNumber(source, keys) {
        for (const key of keys) {
            if (source && hasValue(source[key])) {
                return Number(source[key]);
            }
        }
        return undefined;
    }

    function addMetric(target, key, value) {
        if (hasValue(value)) {
            target[key] = Number(value);
        }
    }

    function extractTypedIntervalMetrics(activity, target) {
        const intervals = Array.isArray(activity && activity.intervals) ? activity.intervals : [];
        const activityType = ActivityTypes.normalizeActivityTypeKey(activity || {});
        intervals.forEach(function (interval) {
            if (!interval || typeof interval !== 'object') {
                return;
            }
            const kind = normalizedKind(
                interval.sport_metric_type || interval.interval_type || interval.kind || interval.type || interval.category
            );
            const increment = hasValue(interval.count) ? Number(interval.count) : 1;
            if (kind === 'lap') {
                target.lap_count = Number(target.lap_count || 0) + increment;
            } else if (kind === 'length' || kind === 'pool_length' || kind === 'swim_length') {
                target.length_count = Number(target.length_count || 0) + increment;
            } else if ((kind === 'ski_run' || kind === 'descent') && DOWNHILL_SNOW_TYPES.has(activityType)) {
                target.ski_run_count = Number(target.ski_run_count || 0) + increment;
            } else if (kind === 'set' || kind === 'strength_set') {
                target.set_count = Number(target.set_count || 0) + increment;
            } else if (kind === 'game' || kind === 'match') {
                target.game_count = Number(target.game_count || 0) + increment;
            } else if (kind === 'hole') {
                target.hole_count = Number(target.hole_count || 0) + increment;
            } else if (kind === 'wave') {
                target.wave_count = Number(target.wave_count || 0) + increment;
            } else if (kind === 'tack') {
                target.tack_count = Number(target.tack_count || 0) + increment;
            } else if (kind === 'floor') {
                target.floor_count = Number(target.floor_count || 0) + increment;
            }
            if (hasValue(interval.total_strokes) || hasValue(interval.strokes)) {
                target.stroke_count = Number(target.stroke_count || 0)
                    + Number(interval.total_strokes !== undefined ? interval.total_strokes : interval.strokes);
            }
            if (hasValue(interval.repetitions) || hasValue(interval.reps)) {
                target.repetition_count = Number(target.repetition_count || 0)
                    + Number(interval.repetitions !== undefined ? interval.repetitions : interval.reps);
            }
        });
    }

    function extractSportMetrics(activity) {
        const normalized = activity || {};
        const stored = normalized.sport_metrics && typeof normalized.sport_metrics === 'object'
            ? normalized.sport_metrics
            : {};
        const metrics = {};
        const aliases = {
            calories: ['calories', 'total_calories'],
            lap_count: ['lap_count', 'num_laps', 'total_laps'],
            length_count: ['length_count', 'num_lengths', 'total_lengths'],
            stroke_count: ['stroke_count', 'total_strokes', 'strokes'],
            ski_run_count: ['ski_run_count', 'ski_runs', 'num_ski_runs'],
            set_count: ['set_count', 'num_sets', 'total_sets'],
            repetition_count: ['repetition_count', 'repetitions', 'total_repetitions', 'total_reps'],
            floor_count: ['floor_count', 'floors', 'floors_climbed'],
            hole_count: ['hole_count', 'holes', 'holes_completed'],
            game_count: ['game_count', 'games', 'games_completed'],
            wave_count: ['wave_count', 'waves', 'waves_caught'],
            tack_count: ['tack_count', 'tacks', 'total_tacks']
        };
        Object.keys(aliases).forEach(function (key) {
            const storedValue = firstNumber(stored, [key].concat(aliases[key]));
            const activityValue = firstNumber(normalized, aliases[key]);
            addMetric(metrics, key, storedValue !== undefined ? storedValue : activityValue);
        });

        if (metrics.lap_count === undefined && Array.isArray(normalized.laps)) {
            metrics.lap_count = normalized.laps.length;
        }
        if (metrics.lap_count === undefined
            && (normalized.provider === 'strava_export'
                || normalized.source_provider === 'strava_export'
                || normalized.import_source === 'strava_export')
            && Array.isArray(normalized.intervals)
            && normalized.intervals.length) {
            metrics.lap_count = normalized.intervals.length;
        }
        const intervalMetrics = {};
        extractTypedIntervalMetrics(normalized, intervalMetrics);
        Object.keys(intervalMetrics).forEach(function (key) {
            if (metrics[key] === undefined) {
                metrics[key] = intervalMetrics[key];
            }
        });
        return metrics;
    }

    function getActivityKpiValues(activity) {
        const normalized = activity || {};
        const values = {
            count: 1,
            distance_meters: Number(normalized.distance || 0),
            moving_time_seconds: Number(normalized.moving_time || 0),
            elapsed_time_seconds: Number(normalized.elapsed_time || 0),
            elevation_gain_meters: Number(normalized.total_elevation_gain || 0)
        };
        return Object.assign(values, extractSportMetrics(normalized));
    }

    function createSnapshot(userSlug, category, options) {
        const opts = options || {};
        return {
            schema_version: SNAPSHOT_SCHEMA_VERSION,
            id: (opts.idPrefix ? opts.idPrefix + ':' : '') + String(userSlug || '').toLowerCase() + ':' + category.key,
            user_slug: String(userSlug || '').toLowerCase(),
            category_key: category.key,
            category_label: category.label,
            count: 0,
            distance_meters: 0,
            moving_time_seconds: 0,
            elapsed_time_seconds: 0,
            elevation_gain_meters: 0,
            metrics: {},
            latest_activity_id: undefined,
            latest_activity_start_date: undefined,
            recomputed_at: new Date()
        };
    }

    function addActivityToSnapshot(snapshot, activity, options) {
        const values = getActivityKpiValues(activity);
        snapshot.count += 1;
        ['distance_meters', 'moving_time_seconds', 'elapsed_time_seconds', 'elevation_gain_meters'].forEach(function (key) {
            snapshot[key] += Number(values[key] || 0);
        });
        Object.keys(METRIC_DEFINITIONS).forEach(function (key) {
            if (!hasValue(values[key])) {
                return;
            }
            if (!snapshot.metrics[key]) {
                snapshot.metrics[key] = { total: 0, supported_count: 0 };
            }
            snapshot.metrics[key].total += Number(values[key]);
            snapshot.metrics[key].supported_count += 1;
        });

        const activityStart = activity && activity.start_date ? new Date(activity.start_date) : null;
        const priorStart = snapshot.latest_activity_start_date ? new Date(snapshot.latest_activity_start_date) : null;
        if (activityStart && !Number.isNaN(activityStart.getTime()) && (!priorStart || activityStart > priorStart)) {
            const resolver = options && typeof options.latestActivityId === 'function'
                ? options.latestActivityId
                : function (item) { return Number(item.strava_id || item.id || 0) || undefined; };
            snapshot.latest_activity_id = resolver(activity);
            snapshot.latest_activity_start_date = activityStart;
        }
    }

    function buildKpiSnapshots(userSlug, activities, options) {
        const opts = options || {};
        const snapshotsByKey = new Map();
        (activities || []).forEach(function (activity) {
            const category = ActivityTypes.getActivityTypeCategory(activity || {});
            if (!snapshotsByKey.has(category.key)) {
                snapshotsByKey.set(category.key, createSnapshot(userSlug, category, opts));
            }
            addActivityToSnapshot(snapshotsByKey.get(category.key), activity, opts);
        });
        return Array.from(snapshotsByKey.values()).sort(function (left, right) {
            return String(left.category_label).localeCompare(String(right.category_label));
        });
    }

    function hasMetric(activityValues, key) {
        return Object.prototype.hasOwnProperty.call(activityValues || {}, key) && hasValue(activityValues[key]);
    }

    function chooseMetric(values, candidates, used) {
        for (const key of candidates) {
            if (!used.has(key) && hasMetric(values, key)) {
                used.add(key);
                return key;
            }
        }
        return '';
    }

    function isIndoorSwimmingActivity(activity) {
        const normalized = activity || {};
        if (ActivityTypes.normalizeActivityTypeKey(normalized) !== 'swim') {
            return false;
        }
        if (normalized.indoor === true || normalized.is_indoor === true || normalized.pool_swim === true
            || normalized.trainer === true) {
            return true;
        }
        if (hasValue(normalized.pool_length) || hasValue(normalized.pool_length_meters)) {
            return true;
        }
        const descriptors = [
            normalized.sub_sport,
            normalized.subSport,
            normalized.sub_type,
            normalized.workout_type_name,
            normalized.activity_subtype,
            normalized.sport_type,
            normalized.type
        ].map(normalizedKind);
        return descriptors.some(function (descriptor) {
            return descriptor === 'pool_swim' || descriptor === 'lap_swimming'
                || descriptor === 'indoor_swim' || descriptor === 'indoor_swimming';
        });
    }

    function getSportMetricSlots(activity, values) {
        const type = ActivityTypes.normalizeActivityTypeKey(activity || {});
        if (DOWNHILL_SNOW_TYPES.has(type)) {
            return [['elevation_gain_meters'], ['ski_run_count', 'calories']];
        }
        if (type === 'nordicski') {
            return [['elevation_gain_meters'], ['calories']];
        }
        if (type === 'swim') {
            return [
                isIndoorSwimmingActivity(activity)
                    ? ['length_count', 'lap_count', 'calories']
                    : ['length_count', 'calories'],
                ['stroke_count', 'calories']
            ];
        }
        if (PADDLE_TYPES.has(type)) {
            return [['stroke_count', 'calories'], ['calories']];
        }
        if (STRENGTH_TYPES.has(type)) {
            return [['repetition_count', 'set_count', 'calories'], ['set_count', 'calories']];
        }
        if (MACHINE_TYPES.has(type)) {
            return [['floor_count', 'calories'], ['set_count', 'calories']];
        }
        if (TEAM_RACKET_TYPES.has(type)) {
            return [
                ['game_count', 'set_count', 'calories'],
                ['repetition_count', 'stroke_count', 'floor_count', 'calories']
            ];
        }
        if (type === 'golf') {
            return [['hole_count', 'calories']];
        }
        if (type === 'surf') {
            return [['wave_count', 'calories']];
        }
        if (SAIL_TYPES.has(type)) {
            return [['tack_count', 'calories']];
        }
        if (WELLNESS_TYPES.has(type)) {
            return [['calories']];
        }
        if (type === 'walk') {
            return [['elevation_gain_meters'], ['calories']];
        }
        if (ELEVATION_TYPES.has(type)) {
            return [['elevation_gain_meters'], ['calories']];
        }
        if (Number(values.elevation_gain_meters || 0) > 0) {
            return [['elevation_gain_meters'], ['calories'].concat(OTHER_ADDITIVE_COUNT_KEYS)];
        }
        return [['calories'], OTHER_ADDITIVE_COUNT_KEYS];
    }

    function getDisplayMetricKeys(activity) {
        const values = getActivityKpiValues(activity);
        const used = new Set(['distance_meters', 'elapsed_time_seconds']);
        const optional = getSportMetricSlots(activity, values).map(function (slot) {
            return chooseMetric(values, slot, used);
        }).filter(Boolean);
        return ['distance_meters', 'elapsed_time_seconds'].concat(optional.slice(0, 2));
    }

    function formatNumber(value, digits) {
        return Number(value || 0).toLocaleString('en-US', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
    }

    function formatElapsed(seconds) {
        const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;
        const parts = [];
        if (hours > 0) {
            parts.push(formatNumber(hours, 0) + 'hr');
        }
        parts.push(formatNumber(minutes, 0) + 'min');
        parts.push(formatNumber(remainingSeconds, 0) + 'sec');
        return parts.join(' ');
    }

    function pluralize(value, singular, plural) {
        return Math.abs(Number(value)) === 1 ? singular : plural;
    }

    function formatOrdinal(value) {
        const number = Math.max(0, Math.round(Number(value || 0)));
        const lastTwoDigits = number % 100;
        if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
            return formatNumber(number, 0) + 'th';
        }
        const lastDigit = number % 10;
        const suffix = lastDigit === 1 ? 'st' : lastDigit === 2 ? 'nd' : lastDigit === 3 ? 'rd' : 'th';
        return formatNumber(number, 0) + suffix;
    }

    function formatElevationMeters(meters, options) {
        const feet = Math.max(0, Math.round(Number(meters || 0) * METERS_TO_FEET));
        if (options && options.total && feet > 5280) {
            const miles = Math.floor(feet / 5280);
            const remainingFeet = feet % 5280;
            if (options.mobile) {
                return formatNumber(miles, 0) + ' mi ' + formatNumber(remainingFeet, 0) + ' ft';
            }
            return formatNumber(miles, 0) + ' ' + pluralize(miles, 'Mile', 'Miles') + ', '
                + formatNumber(remainingFeet, 0) + ' ' + pluralize(remainingFeet, 'Foot', 'Feet');
        }
        return formatNumber(feet, 0) + (options && options.mobile ? ' ft' : ' ' + pluralize(feet, 'Foot', 'Feet'));
    }

    function formatMetricValue(key, value, options) {
        const opts = options || {};
        const prefix = opts.current ? '+' : '';
        if (key === 'distance_meters') {
            return prefix + formatNumber(Number(value || 0) * METERS_TO_MILES, 2) + (opts.mobile ? ' mi' : ' Miles');
        }
        if (key === 'elapsed_time_seconds' || key === 'moving_time_seconds') {
            return prefix + formatElapsed(value);
        }
        if (key === 'elevation_gain_meters') {
            return prefix + formatElevationMeters(value, { total: Boolean(opts.total), mobile: Boolean(opts.mobile) });
        }
        const rounded = Math.max(0, Math.round(Number(value || 0)));
        const definition = METRIC_DEFINITIONS[key] || { singular: key, plural: key, label: key };
        const mobileUnits = MOBILE_COUNT_UNITS[key];
        const unit = opts.mobile && mobileUnits
            ? pluralize(rounded, mobileUnits[0], mobileUnits[1])
            : definition.singular && definition.plural
            ? pluralize(rounded, definition.singular, definition.plural)
            : definition.label;
        return prefix + formatNumber(rounded, 0) + (opts.mobile ? ' ' + String(unit).toLowerCase() : ' ' + unit);
    }

    function getSnapshotMetricTotal(snapshot, key) {
        if (snapshot && snapshot.metrics && snapshot.metrics[key] && hasValue(snapshot.metrics[key].total)) {
            return Number(snapshot.metrics[key].total);
        }
        if (snapshot && hasValue(snapshot[key])) {
            return Number(snapshot[key]);
        }
        return 0;
    }

    function getProgressiveTotal(snapshot, activityValues, key, progress) {
        const finalTotal = getSnapshotMetricTotal(snapshot, key);
        const currentValue = hasMetric(activityValues, key) ? Number(activityValues[key]) : 0;
        const before = Math.max(0, finalTotal - currentValue);
        const ratio = Math.max(0, Math.min(1, Number(progress || 0)));
        const value = before + (currentValue * ratio);
        const kind = METRIC_DEFINITIONS[key] && METRIC_DEFINITIONS[key].kind;
        if (kind === 'count') {
            return Math.floor(value + 1e-9);
        }
        return kind === 'time' ? Math.round(value) : value;
    }

    function buildRollingDigitSequence(previousDigit, nextDigit) {
        const previous = Number(previousDigit);
        const next = Number(nextDigit);
        if (!/^\d$/.test(String(previousDigit)) || !/^\d$/.test(String(nextDigit)) || previous === next) {
            return [];
        }
        const sequence = [String(previous)];
        let cursor = previous;
        while (cursor !== next && sequence.length <= 10) {
            cursor = (cursor + 1) % 10;
            sequence.push(String(cursor));
        }
        return sequence;
    }

    function getOdometerGlyphLayout(value) {
        const text = String(value === undefined || value === null ? '' : value);
        const tokenValues = text.match(/[\d,.]+|[^\d,.]+/g) || [];
        let numberOrdinal = 0;
        let textOrdinal = 0;
        const glyphs = [];
        tokenValues.forEach(function (tokenValue) {
            const numeric = /\d/.test(tokenValue);
            if (numeric) {
                const ordinal = numberOrdinal;
                numberOrdinal += 1;
                const characters = Array.from(tokenValue);
                const digitCount = characters.filter(function (character) { return /\d/.test(character); }).length;
                let digitIndex = 0;
                characters.forEach(function (character, index) {
                    if (/\d/.test(character)) {
                        const placeFromRight = digitCount - digitIndex - 1;
                        digitIndex += 1;
                        glyphs.push({
                            key: 'number-' + ordinal + '-digit-' + placeFromRight,
                            character: character,
                            type: 'digit'
                        });
                        return;
                    }
                    const digitsToRight = characters.slice(index + 1).filter(function (nextCharacter) {
                        return /\d/.test(nextCharacter);
                    }).length;
                    glyphs.push({
                        key: 'number-' + ordinal + '-mark-' + character.charCodeAt(0) + '-' + digitsToRight,
                        character: character,
                        type: 'separator'
                    });
                });
                return;
            }
            const ordinal = textOrdinal;
            textOrdinal += 1;
            Array.from(tokenValue).forEach(function (character, index) {
                glyphs.push({
                    key: 'text-' + ordinal + '-' + index,
                    character: character,
                    type: /\s/.test(character) ? 'space' : 'text'
                });
            });
        });
        return glyphs;
    }

    function buildOdometerTransition(previousValue, nextValue) {
        const previousGlyphs = getOdometerGlyphLayout(previousValue);
        const nextGlyphs = getOdometerGlyphLayout(nextValue);
        const previousByKey = new Map(previousGlyphs.map(function (glyph) {
            return [glyph.key, glyph];
        }));
        const nextKeys = new Set(nextGlyphs.map(function (glyph) { return glyph.key; }));
        return {
            glyphs: nextGlyphs.map(function (glyph) {
                const previousGlyph = previousByKey.get(glyph.key);
                const previousCharacter = previousGlyph ? previousGlyph.character : '';
                return Object.assign({}, glyph, {
                    previousCharacter: previousCharacter,
                    entering: !previousGlyph,
                    changed: Boolean(previousGlyph && previousCharacter !== glyph.character),
                    digitSequence: glyph.type === 'digit'
                        ? buildRollingDigitSequence(previousCharacter, glyph.character)
                        : []
                });
            }),
            leavingKeys: previousGlyphs.filter(function (glyph) {
                return !nextKeys.has(glyph.key);
            }).map(function (glyph) { return glyph.key; })
        };
    }

    return {
        SNAPSHOT_SCHEMA_VERSION: SNAPSHOT_SCHEMA_VERSION,
        METRIC_DEFINITIONS: METRIC_DEFINITIONS,
        extractSportMetrics: extractSportMetrics,
        getActivityKpiValues: getActivityKpiValues,
        buildKpiSnapshots: buildKpiSnapshots,
        isIndoorSwimmingActivity: isIndoorSwimmingActivity,
        getDisplayMetricKeys: getDisplayMetricKeys,
        getSnapshotMetricTotal: getSnapshotMetricTotal,
        getProgressiveTotal: getProgressiveTotal,
        buildRollingDigitSequence: buildRollingDigitSequence,
        getOdometerGlyphLayout: getOdometerGlyphLayout,
        buildOdometerTransition: buildOdometerTransition,
        formatNumber: formatNumber,
        formatElapsed: formatElapsed,
        formatElevationMeters: formatElevationMeters,
        formatMetricValue: formatMetricValue,
        formatOrdinal: formatOrdinal,
        pluralize: pluralize
    };
}));
