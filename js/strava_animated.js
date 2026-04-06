(function (window) {
    'use strict';

    const StravaAnimated = {
        ANIMATE_COUNT: 3,
        CLUSTER_DISTANCE_MILES: 18,
        POST_ANIMATION_DELAY_MS: 3000,
        MIN_DURATION_MS: 1800,
        MAX_DURATION_MS: 9000,
        DURATION_PER_SECOND: 1.1
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

    function getDurationMs(activity) {
        const rawDuration = Number(activity.elapsed_time || 0) * StravaAnimated.DURATION_PER_SECOND;
        return Math.max(StravaAnimated.MIN_DURATION_MS, Math.min(StravaAnimated.MAX_DURATION_MS, rawDuration));
    }

    function interpolatePoint(left, right, progress) {
        return [
            left[0] + ((right[0] - left[0]) * progress),
            left[1] + ((right[1] - left[1]) * progress)
        ];
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
    StravaAnimated.wait = wait;

    window.StravaAnimated = StravaAnimated;
})(window);
