(function (root, factory) {
    'use strict';

    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StravaActivityTypes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function keyFromValue(value) {
        return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    }

    const ACTIVITY_TYPE_CATALOG = [
        { key: 'alpineski', label: 'Alpine Ski', color: '#5f99cf', categoryKey: 'snow_sport', categoryLabel: 'Snow Sports', dailyGroup: 'snow_sport', aliases: ['AlpineSki'] },
        { key: 'backcountryski', label: 'Backcountry Ski', color: '#4f8fc3', categoryKey: 'snow_sport', categoryLabel: 'Snow Sports', dailyGroup: 'snow_sport', aliases: ['BackcountrySki'] },
        { key: 'badminton', label: 'Badminton', color: '#7f7f7f', categoryKey: 'badminton', categoryLabel: 'Badminton', dailyGroup: 'other', aliases: ['Badminton'] },
        { key: 'basketball', label: 'Basketball', color: '#c44e52', categoryKey: 'basketball', categoryLabel: 'Basketball', dailyGroup: 'other', aliases: ['Basketball'] },
        { key: 'canoe', label: 'Canoe', color: '#5254a3', categoryKey: 'canoe', categoryLabel: 'Canoe', dailyGroup: 'other', aliases: ['Canoeing', 'Canoe'] },
        { key: 'cricket', label: 'Cricket', color: '#59a14f', categoryKey: 'cricket', categoryLabel: 'Cricket', dailyGroup: 'other', aliases: ['Cricket'] },
        { key: 'crossfit', label: 'Crossfit', color: '#b5cf6b', categoryKey: 'indoor_training', categoryLabel: 'Indoor Training', dailyGroup: 'other', aliases: ['Crossfit', 'CrossFit'] },
        { key: 'dance', label: 'Dance', color: '#e15759', categoryKey: 'dance', categoryLabel: 'Dance', dailyGroup: 'other', aliases: ['Dance'] },
        { key: 'ebikeride', label: 'E-Bike Ride', color: '#e377c2', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['EBikeRide', 'E-Bike Ride'] },
        { key: 'elliptical', label: 'Elliptical', color: '#cedb9c', categoryKey: 'indoor_training', categoryLabel: 'Indoor Training', dailyGroup: 'other', aliases: ['Elliptical'] },
        { key: 'emountainbikeride', label: 'E-Mountain Bike Ride', color: '#7f7f7f', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['EMountainBikeRide', 'E-Mountain Bike Ride'] },
        { key: 'golf', label: 'Golf', color: '#0a7b0a', categoryKey: 'golf', categoryLabel: 'Golf', dailyGroup: 'other', aliases: ['Golf'] },
        { key: 'gravelride', label: 'Gravel Ride', color: '#8c564b', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['GravelRide'] },
        { key: 'handcycle', label: 'Handcycle', color: '#d62728', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['Handcycle'] },
        { key: 'hiit', label: 'HIIT', color: '#6b6ecf', categoryKey: 'indoor_training', categoryLabel: 'Indoor Training', dailyGroup: 'other', aliases: ['HighIntensityIntervalTraining', 'HIIT'] },
        { key: 'hike', label: 'Hike', color: '#7f642d', categoryKey: 'hike', categoryLabel: 'Hiking', dailyGroup: 'other', aliases: ['Hike', 'Hiking'] },
        { key: 'iceskate', label: 'Ice Skate', color: '#ce6dbd', categoryKey: 'iceskate', categoryLabel: 'Ice Skate', dailyGroup: 'other', aliases: ['IceSkate'] },
        { key: 'inlineskate', label: 'Inline Skate', color: '#de9ed6', categoryKey: 'inlineskate', categoryLabel: 'Inline Skate', dailyGroup: 'other', aliases: ['InlineSkate'] },
        { key: 'kayak', label: 'Kayak', color: '#6b6ecf', categoryKey: 'kayak', categoryLabel: 'Kayak', dailyGroup: 'other', aliases: ['Kayaking', 'Kayak'] },
        { key: 'kitesurf', label: 'Kitesurf', color: '#9c9ede', categoryKey: 'kitesurf', categoryLabel: 'Kitesurf', dailyGroup: 'other', aliases: ['Kitesurf'] },
        { key: 'mountainbikeride', label: 'Mountain Bike Ride', summaryLabel: 'Mountain Biking', color: '#9467bd', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['MountainBikeRide'] },
        { key: 'nordicski', label: 'Nordic Ski', color: '#6aaed6', categoryKey: 'snow_sport', categoryLabel: 'Snow Sports', dailyGroup: 'snow_sport', aliases: ['NordicSki'] },
        { key: 'padel', label: 'Padel', color: '#af7aa1', categoryKey: 'padel', categoryLabel: 'Padel', dailyGroup: 'other', aliases: ['Padel'] },
        { key: 'physicaltherapy', label: 'Physical Therapy', color: '#bab0ab', categoryKey: 'physicaltherapy', categoryLabel: 'Physical Therapy', dailyGroup: 'other', aliases: ['PhysicalTherapy'] },
        { key: 'pickleball', label: 'Pickleball', color: '#17becf', categoryKey: 'pickleball', categoryLabel: 'Pickleball', dailyGroup: 'other', aliases: ['Pickleball'] },
        { key: 'pilates', label: 'Pilates', color: '#9c9ede', categoryKey: 'pilates', categoryLabel: 'Pilates', dailyGroup: 'other', aliases: ['Pilates'] },
        { key: 'racquetball', label: 'Racquetball', color: '#b07aa1', categoryKey: 'racquetball', categoryLabel: 'Racquetball', dailyGroup: 'other', aliases: ['Racquetball'] },
        { key: 'ride', label: 'Ride', summaryLabel: 'Cycling', color: '#ff8000', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['Ride', 'Cycling'] },
        { key: 'rockclimb', label: 'Rock Climb', color: '#ff7f0e', categoryKey: 'rockclimb', categoryLabel: 'Rock Climb', dailyGroup: 'other', aliases: ['RockClimbing', 'RockClimb', 'Rock Climbing'] },
        { key: 'rollerski', label: 'Roller Ski', color: '#2ca02c', categoryKey: 'rollerski', categoryLabel: 'Roller Ski', dailyGroup: 'other', aliases: ['RollerSki'] },
        { key: 'rowing', label: 'Rowing', color: '#637939', categoryKey: 'rowing', categoryLabel: 'Rowing', dailyGroup: 'other', aliases: ['Rowing'] },
        { key: 'run', label: 'Run', color: '#ff0000', categoryKey: 'running', categoryLabel: 'Running', dailyGroup: 'running', aliases: ['Run', 'Running'] },
        { key: 'sail', label: 'Sail', summaryLabel: 'Sailing', color: '#8c6d31', categoryKey: 'sail', categoryLabel: 'Sailing', dailyGroup: 'other', aliases: ['Sail', 'Sailing'] },
        { key: 'skateboard', label: 'Skateboard', color: '#1f77b4', categoryKey: 'skateboard', categoryLabel: 'Skateboard', dailyGroup: 'other', aliases: ['Skateboard'] },
        { key: 'snowboard', label: 'Snowboard', color: '#843c39', categoryKey: 'snow_sport', categoryLabel: 'Snow Sports', dailyGroup: 'snow_sport', aliases: ['Snowboard'] },
        { key: 'snowshoe', label: 'Snowshoe', color: '#a55194', categoryKey: 'snowshoe', categoryLabel: 'Snowshoe', dailyGroup: 'snow_sport', aliases: ['Snowshoe'] },
        { key: 'soccer', label: 'Soccer', color: '#9467bd', categoryKey: 'soccer', categoryLabel: 'Soccer', dailyGroup: 'other', aliases: ['Soccer'] },
        { key: 'squash', label: 'Squash', color: '#5254a3', categoryKey: 'squash', categoryLabel: 'Squash', dailyGroup: 'other', aliases: ['Squash'] },
        { key: 'stairstepper', label: 'Stair Stepper', color: '#8c6d31', categoryKey: 'indoor_training', categoryLabel: 'Indoor Training', dailyGroup: 'other', aliases: ['StairStepper', 'Stair Stepper'] },
        { key: 'standuppaddling', label: 'Paddleboarding', color: '#8ca252', categoryKey: 'standuppaddling', categoryLabel: 'Paddleboarding', dailyGroup: 'other', aliases: ['StandUpPaddling', 'Stand Up Paddling', 'Paddleboarding', 'Paddleboard', 'SUP'] },
        { key: 'surf', label: 'Surf', summaryLabel: 'Surfing', color: '#b5cf6b', categoryKey: 'surf', categoryLabel: 'Surfing', dailyGroup: 'other', aliases: ['Surfing', 'Surf'] },
        { key: 'swim', label: 'Swim', summaryLabel: 'Swimming', color: '#1648ebff', categoryKey: 'swim', categoryLabel: 'Swimming', dailyGroup: 'swimming', aliases: ['Swim', 'Swimming'] },
        { key: 'tabletennis', label: 'Table Tennis', color: '#393b79', categoryKey: 'tabletennis', categoryLabel: 'Table Tennis', dailyGroup: 'other', aliases: ['TableTennis', 'Table Tennis'] },
        { key: 'tennis', label: 'Tennis', color: '#bcbd22', categoryKey: 'tennis', categoryLabel: 'Tennis', dailyGroup: 'other', aliases: ['Tennis'] },
        { key: 'trailrun', label: 'Trail Run', color: '#393b79', categoryKey: 'running', categoryLabel: 'Running', dailyGroup: 'running', aliases: ['TrailRun'] },
        { key: 'velomobile', label: 'Velomobile', color: '#bcbd22', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['Velomobile'] },
        { key: 'virtualride', label: 'Virtual Ride', color: '#17becf', categoryKey: 'cycling', categoryLabel: 'Cycling', dailyGroup: 'cycling', aliases: ['VirtualRide'] },
        { key: 'virtualrow', label: 'Virtual Row', color: '#4e79a7', categoryKey: 'rowing', categoryLabel: 'Rowing', dailyGroup: 'other', aliases: ['VirtualRow'] },
        { key: 'virtualrun', label: 'Virtual Run', color: '#ff0000', categoryKey: 'running', categoryLabel: 'Running', dailyGroup: 'running', aliases: ['VirtualRun'] },
        { key: 'volleyball', label: 'Volleyball', color: '#f28e2b', categoryKey: 'volleyball', categoryLabel: 'Volleyball', dailyGroup: 'other', aliases: ['Volleyball'] },
        { key: 'walk', label: 'Walk', summaryLabel: 'Walking', color: '#000000', categoryKey: 'walk', categoryLabel: 'Walking', dailyGroup: 'walk', aliases: ['Walk', 'Walking'] },
        { key: 'weighttraining', label: 'Weight Training', summaryLabel: 'Indoor Training', color: '#8ca252', categoryKey: 'weighttraining', categoryLabel: 'Weight Training', dailyGroup: 'other', aliases: ['WeightTraining', 'Weight Training'] },
        { key: 'wheelchair', label: 'Wheelchair', color: '#e377c2', categoryKey: 'wheelchair', categoryLabel: 'Wheelchair', dailyGroup: 'other', aliases: ['Wheelchair'] },
        { key: 'windsurf', label: 'Windsurf', color: '#cedb9c', categoryKey: 'windsurf', categoryLabel: 'Windsurf', dailyGroup: 'other', aliases: ['Windsurf'] },
        { key: 'workout', label: 'Workout', summaryLabel: 'Indoor Training', color: '#bd9e39', categoryKey: 'workout', categoryLabel: 'Workout', dailyGroup: 'other', aliases: ['Workout'] },
        { key: 'yoga', label: 'Yoga', color: '#637939', categoryKey: 'yoga', categoryLabel: 'Yoga', dailyGroup: 'other', aliases: ['Yoga'] }
    ];

    const CATALOG_BY_KEY = {};
    const ALIAS_TO_KEY = {};

    ACTIVITY_TYPE_CATALOG.forEach(function (entry) {
        CATALOG_BY_KEY[entry.key] = Object.assign({}, entry);
        ALIAS_TO_KEY[keyFromValue(entry.key)] = entry.key;
        ALIAS_TO_KEY[keyFromValue(entry.label)] = entry.key;
        if (entry.summaryLabel) {
            ALIAS_TO_KEY[keyFromValue(entry.summaryLabel)] = entry.key;
        }
        (entry.aliases || []).forEach(function (alias) {
            ALIAS_TO_KEY[keyFromValue(alias)] = entry.key;
        });
    });

    function resolveKey(value) {
        const rawKey = keyFromValue(value);
        return ALIAS_TO_KEY[rawKey] || rawKey;
    }

    function normalizeActivityTypeKey(activityOrValue) {
        if (activityOrValue && typeof activityOrValue === 'object' && !Array.isArray(activityOrValue)) {
            return resolveKey(activityOrValue.sport_type || activityOrValue.sportType || activityOrValue.activity_type_key || activityOrValue.type);
        }
        return resolveKey(activityOrValue);
    }

    function getActivityTypeEntry(activityOrValue) {
        const key = normalizeActivityTypeKey(activityOrValue);
        return CATALOG_BY_KEY[key] || {
            key: key || 'other',
            label: titleCaseType(key || 'Other'),
            summaryLabel: titleCaseType(key || 'Other'),
            color: '#800080',
            categoryKey: key || 'other',
            categoryLabel: titleCaseType(key || 'Other'),
            dailyGroup: 'other',
            aliases: []
        };
    }

    function titleCaseType(value) {
        return String(value || 'Other')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(function (part) {
                return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            })
            .join(' ') || 'Other';
    }

    function getActivityTypeLabel(activityOrValue) {
        return getActivityTypeEntry(activityOrValue).label;
    }

    function getActivityTypeSummaryLabel(activityOrValue) {
        const entry = getActivityTypeEntry(activityOrValue);
        return entry.summaryLabel || entry.label;
    }

    function getActivityTypeColor(activityOrValue) {
        return getActivityTypeEntry(activityOrValue).color || '#800080';
    }

    function getActivityTypeCategory(activityOrValue) {
        const entry = getActivityTypeEntry(activityOrValue);
        return {
            key: entry.categoryKey || entry.key || 'other',
            label: entry.categoryLabel || entry.label || 'Other'
        };
    }

    function getActivityTypeDailyGroup(activityOrValue) {
        return getActivityTypeEntry(activityOrValue).dailyGroup || 'other';
    }

    function getAllActivityTypes() {
        return ACTIVITY_TYPE_CATALOG.map(function (entry) {
            return Object.assign({}, entry);
        });
    }

    function countActivityTypes(activities) {
        return (activities || []).reduce(function (counts, activity) {
            const key = normalizeActivityTypeKey(activity);
            if (key) {
                counts[key] = (counts[key] || 0) + 1;
            }
            return counts;
        }, {});
    }

    function normalizeCountMap(counts) {
        return Object.entries(counts || {}).reduce(function (nextCounts, entry) {
            const key = normalizeActivityTypeKey(entry[0]);
            if (key) {
                nextCounts[key] = (nextCounts[key] || 0) + Number(entry[1] || 0);
            }
            return nextCounts;
        }, {});
    }

    function sortActivityTypesByCount(counts) {
        const normalizedCounts = normalizeCountMap(counts);
        return getAllActivityTypes().map(function (entry) {
            return Object.assign({}, entry, {
                count: Number(normalizedCounts[entry.key] || 0)
            });
        }).sort(function (left, right) {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return left.label.localeCompare(right.label);
        });
    }

    function getActivityTypeAliases(activityOrValue) {
        const entry = getActivityTypeEntry(activityOrValue);
        return Array.from(new Set([entry.key, entry.label, entry.summaryLabel].concat(entry.aliases || []).filter(Boolean)));
    }

    function getLabelMap(summary) {
        return getAllActivityTypes().reduce(function (map, entry) {
            map[entry.key] = summary ? (entry.summaryLabel || entry.label) : entry.label;
            return map;
        }, {});
    }

    function getColorMap() {
        const colors = getAllActivityTypes().reduce(function (map, entry) {
            map[entry.key] = entry.color;
            return map;
        }, {});
        colors.default = '#800080';
        return colors;
    }

    return {
        ACTIVITY_TYPE_CATALOG: ACTIVITY_TYPE_CATALOG,
        normalizeActivityTypeKey: normalizeActivityTypeKey,
        getActivityTypeEntry: getActivityTypeEntry,
        getActivityTypeLabel: getActivityTypeLabel,
        getActivityTypeSummaryLabel: getActivityTypeSummaryLabel,
        getActivityTypeColor: getActivityTypeColor,
        getActivityTypeCategory: getActivityTypeCategory,
        getActivityTypeDailyGroup: getActivityTypeDailyGroup,
        getAllActivityTypes: getAllActivityTypes,
        countActivityTypes: countActivityTypes,
        sortActivityTypesByCount: sortActivityTypesByCount,
        getActivityTypeAliases: getActivityTypeAliases,
        getSummaryLabelMap: function () { return getLabelMap(true); },
        getTypeLabelMap: function () { return getLabelMap(false); },
        getColorMap: getColorMap
    };
}));
