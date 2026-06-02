(function (window) {
    'use strict';

    // Edit these defaults to tune the recent-route animation and speed-overlay look.
    //const DEFAULT_SPEED_COLOR_SCALE = ['#FCFFDD', '#D7F4CF', '#18BDB0', '#005D9E', '#26185F'];
    //const DEFAULT_SPEED_COLOR_SCALE = ['#FDE725', '#5ec962', '#21918c', '#3b528b', '#440154'];

    const DEFAULT_SPEED_COLOR_SCALE = ['#440154', '#3b528b', '#21918c', '#5ec962', '#FDE725'];
    const DEFAULT_SPEED_COLOR_WEIGHTS = [0, 0.15, 0.35, 0.55, 0.75, 1];
    const StravaAnimated = {
        ANIMATE_COUNT: 1,
        CLUSTER_DISTANCE_MILES: 18,
        POST_ANIMATION_DELAY_MS: 3000,
        MIN_DURATION_MS: 4000,
        MAX_DURATION_MS: 30000,
        DURATION_PER_SECOND: 1.1,
        
        // Higher values make the route animation take longer.
        ANIMATION_DURATION_MULTIPLIER: 5,

        // Higher values make the standard non-selected routes thicker.
        BASE_LINE_WEIGHT_MULTIPLIER: 1,

        // Higher values make the speed-shaded route thicker.
        SPEED_LINE_WEIGHT_MULTIPLIER: 1.8,

        // Toggle the speed-based color palette overlay on or off globally.
        ENABLE_SPEED_COLOR_PALETTE: true,
        SPEED_COLOR_SCALE: DEFAULT_SPEED_COLOR_SCALE.slice(),
        SPEED_COLOR_WEIGHTS: DEFAULT_SPEED_COLOR_WEIGHTS.slice(),

        // Render-only caps for the page-load animation. Stored route/stream data stays full density.
        INTRO_MAX_POINTS_DESKTOP: 650,
        INTRO_MAX_POINTS_MOBILE: 420,
        INTRO_SIMPLIFICATION_TOLERANCE_METERS_DESKTOP: 5,
        INTRO_SIMPLIFICATION_TOLERANCE_METERS_MOBILE: 8,
        INTRO_MIN_FRAME_INTERVAL_MS: 33
    };

    function wait(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, ms);
        });
    }

    function haversineMiles(left, right) {
        const toRadians = Math.PI / 180;
        const lat1 = left[0] * toRadians;
        const lng1 = left[1] * toRadians;
        const lat2 = right[0] * toRadians;
        const lng2 = right[1] * toRadians;
        const latDelta = lat2 - lat1;
        const lngDelta = lng2 - lng1;
        const a = Math.sin(latDelta / 2) * Math.sin(latDelta / 2)
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2);
        return 3958.7613 * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }

    function descriptorCenter(descriptor) {
        const bounds = window.L.latLngBounds(descriptor.coordinates);
        const center = bounds.getCenter();
        return [center.lat, center.lng];
    }

    function getDescriptorTimestamp(descriptor) {
        return new Date(descriptor.activity.start_date || 0).getTime();
    }

    function getAnchorPoint(descriptor) {
        if (Array.isArray(descriptor.activity.start_latlng) && descriptor.activity.start_latlng.length === 2) {
            return descriptor.activity.start_latlng;
        }
        if (descriptor.coordinates && descriptor.coordinates.length) {
            return descriptor.coordinates[0];
        }
        return descriptorCenter(descriptor);
    }

    function getDescriptorDistance(descriptor, anchorPoint) {
        const points = [];
        if (Array.isArray(descriptor.activity.start_latlng) && descriptor.activity.start_latlng.length === 2) {
            points.push(descriptor.activity.start_latlng);
        }
        if (Array.isArray(descriptor.activity.end_latlng) && descriptor.activity.end_latlng.length === 2) {
            points.push(descriptor.activity.end_latlng);
        }
        if (descriptor.coordinates && descriptor.coordinates.length) {
            points.push(descriptor.coordinates[0]);
            points.push(descriptor.coordinates[descriptor.coordinates.length - 1]);
        }
        points.push(descriptorCenter(descriptor));
        return Math.min.apply(null, points.map(function (point) {
            return haversineMiles(anchorPoint, point);
        }));
    }

    function selectRecentDescriptors(descriptors, count) {
        const eligible = (descriptors || []).filter(function (descriptor) {
            return descriptor && descriptor.coordinates && descriptor.coordinates.length > 1;
        }).slice().sort(function (left, right) {
            return getDescriptorTimestamp(right) - getDescriptorTimestamp(left);
        });
        if (!eligible.length) {
            return { animated: [], remaining: [], center: null, bounds: null };
        }

        const limit = typeof count === 'number' ? count : StravaAnimated.ANIMATE_COUNT;
        const anchorDescriptor = eligible[0];
        const anchorPoint = getAnchorPoint(anchorDescriptor);
        const selected = eligible.filter(function (descriptor) {
            return getDescriptorDistance(descriptor, anchorPoint) <= StravaAnimated.CLUSTER_DISTANCE_MILES;
        }).slice(0, limit);
        const selectedKeys = new Set(selected.map(function (descriptor) {
            return descriptor.meta.activityKey;
        }));
        const bounds = window.L.latLngBounds([]);
        selected.forEach(function (descriptor) {
            bounds.extend(window.L.latLngBounds(descriptor.coordinates));
        });

        return {
            animated: selected,
            remaining: (descriptors || []).filter(function (descriptor) {
                return !selectedKeys.has(descriptor.meta.activityKey);
            }),
            center: bounds.isValid() ? bounds.getCenter() : window.L.latLng(anchorPoint[0], anchorPoint[1]),
            bounds: bounds.isValid() ? bounds : window.L.latLngBounds(anchorDescriptor.coordinates)
        };
    }

    function buildDistanceLookup(coordinates) {
        const cumulative = [0];
        let totalDistance = 0;
        for (let index = 1; index < coordinates.length; index += 1) {
            totalDistance += window.L.latLng(coordinates[index - 1][0], coordinates[index - 1][1])
                .distanceTo(window.L.latLng(coordinates[index][0], coordinates[index][1]));
            cumulative.push(totalDistance);
        }
        return { cumulative: cumulative, totalDistance: totalDistance };
    }

    function isMobileViewport() {
        return window.innerWidth <= 900;
    }

    function getIntroMaxPoints() {
        const configured = isMobileViewport()
            ? Number(StravaAnimated.INTRO_MAX_POINTS_MOBILE)
            : Number(StravaAnimated.INTRO_MAX_POINTS_DESKTOP);
        return Number.isFinite(configured) && configured >= 2 ? Math.round(configured) : 650;
    }

    function getIntroSimplificationToleranceMeters() {
        const configured = isMobileViewport()
            ? Number(StravaAnimated.INTRO_SIMPLIFICATION_TOLERANCE_METERS_MOBILE)
            : Number(StravaAnimated.INTRO_SIMPLIFICATION_TOLERANCE_METERS_DESKTOP);
        return Number.isFinite(configured) && configured > 0 ? configured : 5;
    }

    function getIntroFrameIntervalMs() {
        const configured = Number(StravaAnimated.INTRO_MIN_FRAME_INTERVAL_MS);
        return Number.isFinite(configured) && configured > 0 ? configured : 33;
    }

    function shouldOptimizeAnimationTimeline(options, pointCount) {
        const opts = options || {};
        return Boolean(
            pointCount > 2
            && (opts.performanceMode === 'intro' || opts.optimizeLongRoute)
        );
    }

    function latLngToMeters(point, originLatitudeRadians) {
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

    function pointLineDistanceMeters(point, start, end) {
        const originLatitudeRadians = ((Number(point[0]) + Number(start[0]) + Number(end[0])) / 3) * (Math.PI / 180);
        const projectedPoint = latLngToMeters(point, originLatitudeRadians);
        const projectedStart = latLngToMeters(start, originLatitudeRadians);
        const projectedEnd = latLngToMeters(end, originLatitudeRadians);
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

    function simplifyDouglasPeuckerIndices(points, toleranceMeters) {
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
                const distance = pointLineDistanceMeters(points[index], points[startIndex], points[endIndex]);
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

    function capIndicesEvenly(indices, maxPoints) {
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

    function buildOptimizedTimeline(points, times, options) {
        const opts = options || {};
        const sourcePoints = Array.isArray(points) ? points : [];
        const sourceTimes = normalizeTimelineTimes(sourcePoints, times, opts.fallbackDurationSeconds);
        const maxPoints = Number.isFinite(Number(opts.maxPoints)) && Number(opts.maxPoints) >= 2
            ? Math.round(Number(opts.maxPoints))
            : getIntroMaxPoints();
        const baseTolerance = Number.isFinite(Number(opts.toleranceMeters)) && Number(opts.toleranceMeters) > 0
            ? Number(opts.toleranceMeters)
            : getIntroSimplificationToleranceMeters();

        if (!shouldOptimizeAnimationTimeline(opts, sourcePoints.length) || sourcePoints.length <= maxPoints) {
            return {
                points: sourcePoints,
                times: sourceTimes,
                sourcePoints: sourcePoints,
                sourceTimes: sourceTimes,
                sourceIndices: sourcePoints.map(function (_, index) { return index; }),
                optimized: false
            };
        }

        let tolerance = baseTolerance;
        let indices = simplifyDouglasPeuckerIndices(sourcePoints, tolerance);
        for (let attempt = 0; attempt < 10 && indices.length > maxPoints; attempt += 1) {
            tolerance *= 1.45;
            indices = simplifyDouglasPeuckerIndices(sourcePoints, tolerance);
        }
        indices = capIndicesEvenly(indices, maxPoints);
        if (indices.length < 2) {
            indices = [0, sourcePoints.length - 1];
        }

        return {
            points: indices.map(function (index) { return sourcePoints[index]; }),
            times: indices.map(function (index) { return sourceTimes[index]; }),
            sourcePoints: sourcePoints,
            sourceTimes: sourceTimes,
            sourceIndices: indices,
            optimized: true,
            toleranceMeters: tolerance,
            maxPoints: maxPoints
        };
    }

    function simplifyTimelineForAnimation(points, times, options) {
        return buildOptimizedTimeline(points, times, Object.assign({}, options || {}, {
            optimizeLongRoute: true
        }));
    }

    function getAnimationDurationMultiplier() {
        const multiplier = Number(StravaAnimated.ANIMATION_DURATION_MULTIPLIER);
        return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    }

    function getBaseLineWeightMultiplier() {
        const multiplier = Number(StravaAnimated.BASE_LINE_WEIGHT_MULTIPLIER);
        return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    }

    function getSpeedLineWeightMultiplier() {
        const multiplier = Number(StravaAnimated.SPEED_LINE_WEIGHT_MULTIPLIER);
        return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    }

    function getActivityAnimationSpeedMultiplier(activity) {
        const multiplier = Number(activity && (
            activity.animation_speed_multiplier !== undefined
                ? activity.animation_speed_multiplier
                : activity.custom_animation_speed_multiplier
        ));
        return Number.isFinite(multiplier) && multiplier > 0 ? Math.max(0.25, Math.min(4, multiplier)) : 1;
    }

    function isSpeedColorPaletteEnabled() {
        return StravaAnimated.ENABLE_SPEED_COLOR_PALETTE !== false;
    }

    function getSpeedPalette() {
        const palette = Array.isArray(StravaAnimated.SPEED_COLOR_SCALE)
            ? StravaAnimated.SPEED_COLOR_SCALE.map(function (value) {
                return String(value || '').trim();
            }).filter(Boolean)
            : [];
        return palette.length ? palette : DEFAULT_SPEED_COLOR_SCALE.slice();
    }

    function buildEvenlySpacedWeights(colorCount) {
        if (!(colorCount > 0)) {
            return [0, 1];
        }
        return Array.from({ length: colorCount + 1 }, function (_, index) {
            return index / colorCount;
        });
    }

    function getSpeedPaletteWeights() {
        const palette = getSpeedPalette();
        const fallbackWeights = buildEvenlySpacedWeights(palette.length);
        const rawWeights = Array.isArray(StravaAnimated.SPEED_COLOR_WEIGHTS)
            ? StravaAnimated.SPEED_COLOR_WEIGHTS
            : [];

        if (rawWeights.length !== palette.length + 1) {
            return fallbackWeights;
        }

        const normalized = [0];
        for (let index = 1; index < rawWeights.length - 1; index += 1) {
            const numericValue = Number(rawWeights[index]);
            if (!Number.isFinite(numericValue)) {
                return fallbackWeights;
            }
            normalized.push(Math.max(normalized[index - 1], Math.min(1, numericValue)));
        }
        normalized.push(1);
        return normalized;
    }

    function getDurationMs(activity) {
        const rawDuration = Number(activity.elapsed_time || 0)
            * StravaAnimated.DURATION_PER_SECOND
            * getAnimationDurationMultiplier()
            / getActivityAnimationSpeedMultiplier(activity);
        return Math.max(StravaAnimated.MIN_DURATION_MS, Math.min(StravaAnimated.MAX_DURATION_MS, rawDuration));
    }

    function normalizeTimelineTimes(points, times, fallbackDurationSeconds) {
        const totalPoints = Array.isArray(points) ? points.length : 0;
        const fallbackDuration = Number(fallbackDurationSeconds || 0);
        if (totalPoints <= 1) {
            return [0];
        }
        const numericTimes = Array.isArray(times) ? times.map(function (value) {
            return Number(value);
        }).filter(function (value) {
            return Number.isFinite(value) && value >= 0;
        }) : [];
        if (numericTimes.length === totalPoints) {
            const normalized = [numericTimes[0]];
            for (let index = 1; index < numericTimes.length; index += 1) {
                normalized.push(Math.max(numericTimes[index], normalized[index - 1]));
            }
            if (normalized[normalized.length - 1] > 0) {
                return normalized;
            }
        }
        const syntheticDuration = fallbackDuration > 0 ? fallbackDuration : totalPoints - 1;
        return Array.from({ length: totalPoints }, function (_, index) {
            return (syntheticDuration * index) / Math.max(totalPoints - 1, 1);
        });
    }

    function interpolatePoint(left, right, progress) {
        return [
            left[0] + ((right[0] - left[0]) * progress),
            left[1] + ((right[1] - left[1]) * progress)
        ];
    }

    function getTimelineFrame(points, times, targetTime) {
        const normalizedPoints = Array.isArray(points) ? points : [];
        const normalizedTimes = normalizeTimelineTimes(normalizedPoints, times, 0);
        if (normalizedPoints.length < 2) {
            return {
                targetTime: 0,
                visibleCoordinates: normalizedPoints.slice(),
                segmentIndex: 0,
                nextIndex: 0,
                segmentProgress: 1
            };
        }

        const totalTime = normalizedTimes[normalizedTimes.length - 1] || 1;
        const clampedTargetTime = Math.max(0, Math.min(totalTime, Number(targetTime || 0)));
        let segmentIndex = 0;

        while (segmentIndex < normalizedTimes.length - 1 && normalizedTimes[segmentIndex + 1] < clampedTargetTime) {
            segmentIndex += 1;
        }

        const nextIndex = Math.min(segmentIndex + 1, normalizedPoints.length - 1);
        const startTime = normalizedTimes[segmentIndex];
        const endTime = normalizedTimes[nextIndex];
        const segmentDuration = endTime - startTime;
        const segmentProgress = segmentDuration <= 0 ? 1 : (clampedTargetTime - startTime) / segmentDuration;
        const visibleCoordinates = normalizedPoints.slice(0, nextIndex);
        visibleCoordinates.push(interpolatePoint(
            normalizedPoints[segmentIndex],
            normalizedPoints[nextIndex],
            Math.max(0, Math.min(1, segmentProgress))
        ));

        return {
            targetTime: clampedTargetTime,
            totalTime: totalTime,
            visibleCoordinates: visibleCoordinates,
            segmentIndex: segmentIndex,
            nextIndex: nextIndex,
            segmentProgress: Math.max(0, Math.min(1, segmentProgress))
        };
    }

    function getTimelineFrameWithCursor(points, times, targetTime, cursorState) {
        const normalizedPoints = Array.isArray(points) ? points : [];
        const normalizedTimes = Array.isArray(times) ? times : normalizeTimelineTimes(normalizedPoints, [], 0);
        const cursor = cursorState || {};
        if (normalizedPoints.length < 2) {
            return {
                targetTime: 0,
                totalTime: 0,
                visibleCoordinates: normalizedPoints.slice(),
                segmentIndex: 0,
                nextIndex: 0,
                segmentProgress: 1
            };
        }

        const totalTime = normalizedTimes[normalizedTimes.length - 1] || 1;
        const clampedTargetTime = Math.max(0, Math.min(totalTime, Number(targetTime || 0)));
        let segmentIndex = Math.max(0, Math.min(normalizedPoints.length - 2, Number(cursor.segmentIndex || 0)));
        if (normalizedTimes[segmentIndex] > clampedTargetTime) {
            segmentIndex = 0;
        }

        while (segmentIndex < normalizedTimes.length - 1 && normalizedTimes[segmentIndex + 1] < clampedTargetTime) {
            segmentIndex += 1;
        }
        cursor.segmentIndex = segmentIndex;

        const nextIndex = Math.min(segmentIndex + 1, normalizedPoints.length - 1);
        const startTime = normalizedTimes[segmentIndex];
        const endTime = normalizedTimes[nextIndex];
        const segmentDuration = endTime - startTime;
        const segmentProgress = segmentDuration <= 0 ? 1 : (clampedTargetTime - startTime) / segmentDuration;
        const visibleCoordinates = normalizedPoints.slice(0, nextIndex);
        visibleCoordinates.push(interpolatePoint(
            normalizedPoints[segmentIndex],
            normalizedPoints[nextIndex],
            Math.max(0, Math.min(1, segmentProgress))
        ));

        return {
            targetTime: clampedTargetTime,
            totalTime: totalTime,
            visibleCoordinates: visibleCoordinates,
            segmentIndex: segmentIndex,
            nextIndex: nextIndex,
            segmentProgress: Math.max(0, Math.min(1, segmentProgress))
        };
    }

    function animateTimedRoute(options) {
        const opts = options || {};
        const sourcePoints = Array.isArray(opts.points) ? opts.points : [];
        const sourceTimes = normalizeTimelineTimes(sourcePoints, opts.times, opts.fallbackDurationSeconds);
        const renderTimeline = buildOptimizedTimeline(sourcePoints, sourceTimes, opts);
        const points = renderTimeline.points;
        const times = renderTimeline.times;
        const totalTime = times[times.length - 1] || 1;
        const durationMs = typeof opts.durationMs === 'number' ? opts.durationMs : 1000;
        const minFrameIntervalMs = shouldOptimizeAnimationTimeline(opts, sourcePoints.length) ? getIntroFrameIntervalMs() : 0;

        return new Promise(function (resolve) {
            let startTime = null;
            let lastRenderedAt = 0;
            let lastFrameKey = '';
            const cursorState = { segmentIndex: 0 };

            function decorateFrame(frame, progress) {
                frame.progress = progress;
                frame.points = points;
                frame.times = times;
                frame.sourcePoints = sourcePoints;
                frame.sourceTimes = sourceTimes;
                frame.sourceIndices = renderTimeline.sourceIndices;
                frame.optimized = renderTimeline.optimized;
                return frame;
            }

            function step(timestamp) {
                if (startTime === null) {
                    startTime = timestamp;
                    if (typeof opts.onStart === 'function') {
                        opts.onStart();
                    }
                }

                if (typeof opts.shouldCancel === 'function' && opts.shouldCancel()) {
                    const frame = decorateFrame(getTimelineFrameWithCursor(points, times, totalTime, cursorState), 1);
                    if (typeof opts.onFrame === 'function') {
                        opts.onFrame(frame);
                    }
                    if (typeof opts.onComplete === 'function') {
                        opts.onComplete(frame);
                    }
                    resolve(frame);
                    return;
                }

                const progress = Math.min(1, (timestamp - startTime) / Math.max(durationMs, 1));
                const targetTime = totalTime * progress;
                const shouldRender = progress >= 1
                    || lastRenderedAt === 0
                    || !minFrameIntervalMs
                    || timestamp - lastRenderedAt >= minFrameIntervalMs;

                if (shouldRender) {
                    const frame = decorateFrame(getTimelineFrameWithCursor(points, times, targetTime, cursorState), progress);
                    const frameKey = frame.nextIndex + ':' + Math.round(frame.segmentProgress * 30);
                    if (progress >= 1 || frameKey !== lastFrameKey) {
                        lastFrameKey = frameKey;
                        lastRenderedAt = timestamp;
                        if (typeof opts.onFrame === 'function') {
                            opts.onFrame(frame);
                        }
                    }
                }

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                    return;
                }

                const frame = decorateFrame(getTimelineFrameWithCursor(points, times, totalTime, cursorState), 1);
                if (typeof opts.onComplete === 'function') {
                    opts.onComplete(frame);
                }
                resolve(frame);
            }

            if (!sourcePoints.length) {
                resolve({ targetTime: 0, totalTime: 0, visibleCoordinates: [], progress: 1, points: [], times: [] });
                return;
            }

            window.requestAnimationFrame(step);
        });
    }

    function animateDescriptor(map, descriptor) {
        return new Promise(function (resolve) {
            const coordinates = descriptor.coordinates;
            if (coordinates.length < 2) {
                resolve(window.StravaApp.createPolylineLayer(map, descriptor, coordinates));
                return;
            }

            const layer = window.StravaApp.createPolylineLayer(map, descriptor, [coordinates[0]]);
            const lookup = buildDistanceLookup(coordinates);
            const durationMs = getDurationMs(descriptor.activity);
            let startTime = null;

            function step(timestamp) {
                if (startTime === null) {
                    startTime = timestamp;
                }

                const progress = Math.min(1, (timestamp - startTime) / durationMs);
                const targetDistance = lookup.totalDistance * progress;
                let segmentIndex = 0;

                while (segmentIndex < lookup.cumulative.length - 1 && lookup.cumulative[segmentIndex + 1] < targetDistance) {
                    segmentIndex += 1;
                }

                const nextIndex = Math.min(segmentIndex + 1, coordinates.length - 1);
                const segmentStart = lookup.cumulative[segmentIndex];
                const segmentEnd = lookup.cumulative[nextIndex];
                const segmentDistance = segmentEnd - segmentStart;
                const segmentProgress = segmentDistance === 0 ? 1 : (targetDistance - segmentStart) / segmentDistance;
                const visibleCoordinates = coordinates.slice(0, nextIndex);
                visibleCoordinates.push(interpolatePoint(
                    coordinates[segmentIndex],
                    coordinates[nextIndex],
                    Math.max(0, Math.min(1, segmentProgress))
                ));
                layer.setLatLngs(visibleCoordinates);

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                    return;
                }

                layer.setLatLngs(coordinates);
                resolve(layer);
            }

            window.requestAnimationFrame(step);
        });
    }

    function animateRecentDescriptors(map, descriptors) {
        return Promise.all((descriptors || []).map(function (descriptor) {
            return animateDescriptor(map, descriptor);
        }));
    }

    StravaAnimated.selectRecentDescriptors = selectRecentDescriptors;
    StravaAnimated.animateDescriptor = animateDescriptor;
    StravaAnimated.animateRecentDescriptors = animateRecentDescriptors;
    StravaAnimated.animateTimedRoute = animateTimedRoute;
    StravaAnimated.getTimelineFrame = getTimelineFrame;
    StravaAnimated.simplifyTimelineForAnimation = simplifyTimelineForAnimation;
    StravaAnimated.getDurationMs = getDurationMs;
    StravaAnimated.getBaseLineWeightMultiplier = getBaseLineWeightMultiplier;
    StravaAnimated.getSpeedPalette = getSpeedPalette;
    StravaAnimated.getSpeedPaletteWeights = getSpeedPaletteWeights;
    StravaAnimated.getSpeedLineWeightMultiplier = getSpeedLineWeightMultiplier;
    StravaAnimated.getActivityAnimationSpeedMultiplier = getActivityAnimationSpeedMultiplier;
    StravaAnimated.isSpeedColorPaletteEnabled = isSpeedColorPaletteEnabled;
    StravaAnimated.wait = wait;

    window.StravaAnimated = StravaAnimated;
})(window);
