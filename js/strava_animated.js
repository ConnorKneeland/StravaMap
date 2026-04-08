(function (window) {
    'use strict';

    // Edit these defaults to tune the recent-route animation and speed-overlay look.
    //const DEFAULT_SPEED_COLOR_SCALE = ['#FCFFDD', '#D7F4CF', '#18BDB0', '#005D9E', '#26185F'];
    //const DEFAULT_SPEED_COLOR_SCALE = ['#FDE725', '#5ec962', '#21918c', '#3b528b', '#440154'];

    const DEFAULT_SPEED_COLOR_SCALE = ['#440154', '#3b528b', '#21918c', '#5ec962', '#FDE725'];
    const StravaAnimated = {
        ANIMATE_COUNT: 1,
        CLUSTER_DISTANCE_MILES: 18,
        POST_ANIMATION_DELAY_MS: 3000,
        MIN_DURATION_MS: 4000,
        MAX_DURATION_MS: 30000,
        DURATION_PER_SECOND: 1.1,
        // Higher values make the route animation take longer.
        ANIMATION_DURATION_MULTIPLIER: 3,
        // Higher values make the standard non-selected routes thicker.
        BASE_LINE_WEIGHT_MULTIPLIER: 1,
        // Higher values make the speed-shaded route thicker.
        SPEED_LINE_WEIGHT_MULTIPLIER: 1.8,
        // Toggle the speed-based color palette overlay on or off globally.
        ENABLE_SPEED_COLOR_PALETTE: true,
        SPEED_COLOR_SCALE: DEFAULT_SPEED_COLOR_SCALE.slice()
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

    function getDurationMs(activity) {
        const rawDuration = Number(activity.elapsed_time || 0) * StravaAnimated.DURATION_PER_SECOND * getAnimationDurationMultiplier();
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

    function animateTimedRoute(options) {
        const opts = options || {};
        const points = Array.isArray(opts.points) ? opts.points : [];
        const times = normalizeTimelineTimes(points, opts.times, opts.fallbackDurationSeconds);
        const totalTime = times[times.length - 1] || 1;
        const durationMs = typeof opts.durationMs === 'number' ? opts.durationMs : 1000;

        return new Promise(function (resolve) {
            let startTime = null;

            function step(timestamp) {
                if (startTime === null) {
                    startTime = timestamp;
                    if (typeof opts.onStart === 'function') {
                        opts.onStart();
                    }
                }

                const progress = Math.min(1, (timestamp - startTime) / Math.max(durationMs, 1));
                const targetTime = totalTime * progress;
                const frame = getTimelineFrame(points, times, targetTime);
                frame.progress = progress;
                frame.points = points;
                frame.times = times;

                if (typeof opts.onFrame === 'function') {
                    opts.onFrame(frame);
                }

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                    return;
                }

                if (typeof opts.onComplete === 'function') {
                    opts.onComplete(frame);
                }
                resolve(frame);
            }

            if (!points.length) {
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
    StravaAnimated.getDurationMs = getDurationMs;
    StravaAnimated.getBaseLineWeightMultiplier = getBaseLineWeightMultiplier;
    StravaAnimated.getSpeedPalette = getSpeedPalette;
    StravaAnimated.getSpeedLineWeightMultiplier = getSpeedLineWeightMultiplier;
    StravaAnimated.isSpeedColorPaletteEnabled = isSpeedColorPaletteEnabled;
    StravaAnimated.wait = wait;

    window.StravaAnimated = StravaAnimated;
})(window);
