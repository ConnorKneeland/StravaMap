const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');
const unzipper = require('unzipper');
const ActivityTypes = require('../../js/strava_activity_types');
const ActivityKpis = require('../../js/activity_kpis');
const { normalizeSlug } = require('./connection');
const {
    PROVIDER,
    getConnectionStore
} = require('./intervals_auth');
const {
    getIntervalsActivityStore,
    recomputeIntervalsKpis
} = require('./intervals_sync');
const {
    countStreamDatapoints,
    compareActivityRichness,
    reconcileDuplicateActivitiesForSlug
} = require('./intervals_dedupe');

const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 50000;
const MAX_CSV_BYTES = 20 * 1024 * 1024;
const MAX_ACTIVITY_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TARGET_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const SUPPORTED_ACTIVITY_SUFFIXES = Object.freeze(['.fit.gz', '.gpx.gz', '.tcx.gz', '.fit', '.gpx', '.tcx']);
const activeImports = new Set();
let fitSdkPromise;

class StravaExportImportError extends Error {
    constructor(message, statusCode, code) {
        super(message);
        this.name = 'StravaExportImportError';
        this.statusCode = Number(statusCode || 400);
        this.code = code || 'strava_export_import_failed';
    }
}

function getMaxUploadBytes() {
    const configured = Number(process.env.STRAVA_EXPORT_MAX_ZIP_BYTES || 0);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

function isStravaExportImportActive(slugValue) {
    return activeImports.has(normalizeSlug(slugValue));
}

function normalizeArchivePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isSupportedActivityPath(value) {
    const normalized = normalizeArchivePath(value).toLowerCase();
    return normalized.includes('/activities/') || normalized.startsWith('activities/')
        ? SUPPORTED_ACTIVITY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
        : false;
}

function parseCsvRows(textValue) {
    const text = String(textValue || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ',') {
            row.push(field);
            field = '';
        } else if (character === '\n') {
            row.push(field.replace(/\r$/, ''));
            if (row.some((value) => value !== '')) rows.push(row);
            row = [];
            field = '';
        } else {
            field += character;
        }
    }
    if (quoted) throw new StravaExportImportError('activities.csv contains an unterminated quoted field', 400, 'invalid_csv');
    if (field || row.length) {
        row.push(field.replace(/\r$/, ''));
        if (row.some((value) => value !== '')) rows.push(row);
    }
    return rows;
}

function createColumnLookup(headers) {
    return headers.reduce((lookup, header, index) => {
        const key = String(header || '').trim();
        if (!lookup.has(key)) lookup.set(key, []);
        lookup.get(key).push(index);
        return lookup;
    }, new Map());
}

function getCsvField(row, columns, name, occurrence) {
    const indexes = columns.get(name) || [];
    if (!indexes.length) return '';
    const index = occurrence === 'first' ? indexes[0] : indexes[indexes.length - 1];
    return String(row[index] === undefined || row[index] === null ? '' : row[index]).trim();
}

function toFiniteNumber(value) {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    const number = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(number) ? number : undefined;
}

function toBoolean(value) {
    return ['true', '1', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

const MONTHS = Object.freeze({
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
});

function parseStravaDate(value) {
    const match = String(value || '').trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s+([AP]M)$/i);
    if (!match || MONTHS[match[1].toLowerCase()] === undefined) return null;
    let hour = Number(match[4]);
    if (String(match[7]).toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (String(match[7]).toUpperCase() === 'AM' && hour === 12) hour = 0;
    const parts = {
        year: Number(match[3]), month: MONTHS[match[1].toLowerCase()], day: Number(match[2]),
        hour, minute: Number(match[5]), second: Number(match[6])
    };
    const date = new Date(Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second));
    if (Number.isNaN(date.getTime())) return null;
    const pad = (number) => String(number).padStart(2, '0');
    return {
        date,
        localIso: `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    };
}

function compactObject(value) {
    return Object.entries(value || {}).reduce((result, [key, item]) => {
        if (item !== undefined && item !== null && item !== '') result[key] = item;
        return result;
    }, {});
}

function semicirclesToDegrees(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number * (180 / 2147483648) : undefined;
}

function validCoordinate(latitude, longitude) {
    return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function haversineMeters(left, right) {
    if (!left || !right) return 0;
    const radians = (degrees) => degrees * Math.PI / 180;
    const earthRadius = 6371000;
    const latitudeDelta = radians(right[0] - left[0]);
    const longitudeDelta = radians(right[1] - left[1]);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(left[0])) * Math.cos(radians(right[0])) * Math.sin(longitudeDelta / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildStreamPayload(samplesValue) {
    const allSamples = (samplesValue || []).filter((sample) => sample && sample.timestamp instanceof Date
        && !Number.isNaN(sample.timestamp.getTime()));
    const routeSamples = allSamples.filter((sample) => Array.isArray(sample.latlng)
        && validCoordinate(Number(sample.latlng[0]), Number(sample.latlng[1])));
    const samples = routeSamples.length >= 2 ? routeSamples : allSamples;
    if (!samples.length) {
        return {
            stream_data: {}, stream_keys: [], stream_latlng: [], stream_time: [], stream_velocity_smooth: [],
            datapoint_count: 0, stream_count: 0, start_date: null
        };
    }
    const startMs = samples[0].timestamp.getTime();
    const definitions = {
        time: (sample) => Math.max(0, (sample.timestamp.getTime() - startMs) / 1000),
        latlng: (sample) => sample.latlng,
        distance: (sample) => sample.distance,
        altitude: (sample) => sample.altitude,
        velocity_smooth: (sample) => sample.speed,
        heartrate: (sample) => sample.heartrate,
        cadence: (sample) => sample.cadence,
        watts: (sample) => sample.watts,
        temp: (sample) => sample.temp,
        grade_smooth: (sample) => sample.grade
    };
    const streamData = {};
    for (const [key, resolver] of Object.entries(definitions)) {
        const values = samples.map((sample) => {
            const value = resolver(sample);
            if (key === 'latlng') return Array.isArray(value) ? value.map(Number) : null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        });
        if (key === 'time' || values.some((value) => value !== null)) streamData[key] = values;
    }
    return {
        stream_data: streamData,
        stream_keys: Object.keys(streamData),
        stream_latlng: streamData.latlng || [],
        stream_time: streamData.time || [],
        stream_velocity_smooth: streamData.velocity_smooth || [],
        datapoint_count: countStreamDatapoints(streamData),
        stream_count: Object.keys(streamData).length,
        start_date: samples[0].timestamp
    };
}

async function getFitSdk() {
    if (!fitSdkPromise) fitSdkPromise = import('@garmin/fitsdk');
    return fitSdkPromise;
}

function normalizeFitIntervals(laps) {
    return (laps || []).map((lap, index) => compactObject({
        id: String(index + 1),
        name: `Lap ${index + 1}`,
        sport_metric_type: 'lap',
        start_date: lap.startTime instanceof Date ? lap.startTime.toISOString() : undefined,
        elapsed_time: toFiniteNumber(lap.totalElapsedTime),
        moving_time: toFiniteNumber(lap.totalTimerTime),
        distance: toFiniteNumber(lap.totalDistance),
        average_heartrate: toFiniteNumber(lap.avgHeartRate),
        max_heartrate: toFiniteNumber(lap.maxHeartRate),
        average_watts: toFiniteNumber(lap.avgPower),
        max_watts: toFiniteNumber(lap.maxPower),
        average_cadence: toFiniteNumber(lap.avgCadence),
        total_elevation_gain: toFiniteNumber(lap.totalAscent)
    }));
}

async function decodeFitActivity(buffer) {
    const { Decoder, Stream } = await getFitSdk();
    const decoder = new Decoder(Stream.fromBuffer(buffer));
    if (!decoder.isFIT()) throw new Error('The linked activity file is not a valid FIT file');
    const decoded = decoder.read({
        applyScaleAndOffset: true,
        expandSubFields: true,
        expandComponents: true,
        convertTypesToStrings: true,
        convertDateTimesToDates: true,
        mergeHeartRates: true
    });
    const messages = decoded.messages || {};
    const records = messages.recordMesgs || [];
    const samples = records.map((record) => {
        const latitude = semicirclesToDegrees(record.positionLat);
        const longitude = semicirclesToDegrees(record.positionLong);
        return compactObject({
            timestamp: record.timestamp instanceof Date ? record.timestamp : null,
            latlng: validCoordinate(latitude, longitude) ? [latitude, longitude] : undefined,
            distance: toFiniteNumber(record.distance),
            altitude: toFiniteNumber(record.enhancedAltitude !== undefined ? record.enhancedAltitude : record.altitude),
            speed: toFiniteNumber(record.enhancedSpeed !== undefined ? record.enhancedSpeed : record.speed),
            heartrate: toFiniteNumber(record.heartRate),
            cadence: toFiniteNumber(record.cadence),
            watts: toFiniteNumber(record.power),
            temp: toFiniteNumber(record.temperature),
            grade: toFiniteNumber(record.grade)
        });
    });
    const streams = buildStreamPayload(samples);
    const session = (messages.sessionMesgs || [])[0] || {};
    const activity = (messages.activityMesgs || [])[0] || {};
    const fileId = (messages.fileIdMesgs || [])[0] || {};
    const lapMessages = messages.lapMesgs || [];
    const lengthMessages = messages.lengthMesgs || [];
    const setMessages = messages.setMesgs || [];
    const totalStrokes = lengthMessages.reduce((sum, length) => {
        const value = toFiniteNumber(length && length.totalStrokes);
        return sum + (value === undefined ? 0 : value);
    }, 0);
    const totalRepetitions = setMessages.reduce((sum, set) => {
        const value = toFiniteNumber(set && set.repetitions);
        return sum + (value === undefined ? 0 : value);
    }, 0);
    const sportMetrics = compactObject({
        calories: toFiniteNumber(session.totalCalories),
        lap_count: lapMessages.length || undefined,
        length_count: lengthMessages.length || undefined,
        stroke_count: lengthMessages.some((length) => toFiniteNumber(length && length.totalStrokes) !== undefined)
            ? totalStrokes
            : undefined,
        set_count: setMessages.length || undefined,
        repetition_count: setMessages.some((set) => toFiniteNumber(set && set.repetitions) !== undefined)
            ? totalRepetitions
            : undefined
    });
    return Object.assign({}, streams, {
        file_type: 'fit',
        warnings: (decoded.errors || []).map(String),
        intervals: normalizeFitIntervals(lapMessages),
        sport_metrics: sportMetrics,
        details: compactObject({
            start_date: session.startTime instanceof Date ? session.startTime
                : (activity.timestamp instanceof Date ? activity.timestamp : streams.start_date),
            distance: toFiniteNumber(session.totalDistance),
            elapsed_time: toFiniteNumber(session.totalElapsedTime),
            moving_time: toFiniteNumber(session.totalTimerTime),
            total_elevation_gain: toFiniteNumber(session.totalAscent),
            total_elevation_loss: toFiniteNumber(session.totalDescent),
            average_speed: toFiniteNumber(session.enhancedAvgSpeed !== undefined ? session.enhancedAvgSpeed : session.avgSpeed),
            max_speed: toFiniteNumber(session.enhancedMaxSpeed !== undefined ? session.enhancedMaxSpeed : session.maxSpeed),
            average_heartrate: toFiniteNumber(session.avgHeartRate),
            max_heartrate: toFiniteNumber(session.maxHeartRate),
            average_cadence: toFiniteNumber(session.avgCadence),
            average_watts: toFiniteNumber(session.avgPower),
            max_watts: toFiniteNumber(session.maxPower),
            calories: toFiniteNumber(session.totalCalories),
            average_temp: toFiniteNumber(session.avgTemperature),
            device_name: fileId.manufacturer && fileId.manufacturer !== 'strava'
                ? String(fileId.manufacturer)
                : undefined
        })
    });
}

function extractXmlTag(body, tagName) {
    const expression = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tagName}>`, 'i');
    const match = String(body || '').match(expression);
    return match ? match[1].trim() : '';
}

function decodeGpxActivity(buffer) {
    const xml = buffer.toString('utf8');
    const samples = [];
    const expression = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
    let match;
    let cumulativeDistance = 0;
    let previous;
    while ((match = expression.exec(xml))) {
        const latitudeMatch = match[1].match(/\blat=["']([^"']+)["']/i);
        const longitudeMatch = match[1].match(/\blon=["']([^"']+)["']/i);
        const latitude = toFiniteNumber(latitudeMatch && latitudeMatch[1]);
        const longitude = toFiniteNumber(longitudeMatch && longitudeMatch[1]);
        const time = new Date(extractXmlTag(match[2], 'time'));
        if (!validCoordinate(latitude, longitude) || Number.isNaN(time.getTime())) continue;
        const latlng = [latitude, longitude];
        const segmentDistance = previous ? haversineMeters(previous.latlng, latlng) : 0;
        cumulativeDistance += segmentDistance;
        const seconds = previous ? (time.getTime() - previous.timestamp.getTime()) / 1000 : 0;
        const sample = compactObject({
            timestamp: time,
            latlng,
            distance: cumulativeDistance,
            altitude: toFiniteNumber(extractXmlTag(match[2], 'ele')),
            speed: seconds > 0 ? segmentDistance / seconds : undefined,
            heartrate: toFiniteNumber(extractXmlTag(match[2], 'hr')),
            cadence: toFiniteNumber(extractXmlTag(match[2], 'cad')),
            watts: toFiniteNumber(extractXmlTag(match[2], 'power')),
            temp: toFiniteNumber(extractXmlTag(match[2], 'atemp'))
        });
        samples.push(sample);
        previous = sample;
    }
    if (!samples.length) throw new Error('The linked GPX file did not contain usable trackpoints');
    return Object.assign({}, buildStreamPayload(samples), {
        file_type: 'gpx', warnings: [], intervals: [], details: { start_date: samples[0].timestamp }
    });
}

function decodeTcxActivity(buffer) {
    const xml = buffer.toString('utf8');
    const samples = [];
    const expression = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/gi;
    let match;
    while ((match = expression.exec(xml))) {
        const latitude = toFiniteNumber(extractXmlTag(match[1], 'LatitudeDegrees'));
        const longitude = toFiniteNumber(extractXmlTag(match[1], 'LongitudeDegrees'));
        const time = new Date(extractXmlTag(match[1], 'Time'));
        if (Number.isNaN(time.getTime())) continue;
        samples.push(compactObject({
            timestamp: time,
            latlng: validCoordinate(latitude, longitude) ? [latitude, longitude] : undefined,
            distance: toFiniteNumber(extractXmlTag(match[1], 'DistanceMeters')),
            altitude: toFiniteNumber(extractXmlTag(match[1], 'AltitudeMeters')),
            speed: toFiniteNumber(extractXmlTag(match[1], 'Speed')),
            heartrate: toFiniteNumber(extractXmlTag(extractXmlTag(match[1], 'HeartRateBpm'), 'Value')),
            cadence: toFiniteNumber(extractXmlTag(match[1], 'Cadence')),
            watts: toFiniteNumber(extractXmlTag(match[1], 'Watts'))
        }));
    }
    if (!samples.length) throw new Error('The linked TCX file did not contain usable trackpoints');
    return Object.assign({}, buildStreamPayload(samples), {
        file_type: 'tcx', warnings: [], intervals: [], details: { start_date: samples[0].timestamp }
    });
}

function decompressActivityBuffer(buffer, fileName) {
    if (!String(fileName).toLowerCase().endsWith('.gz')) return buffer;
    return zlib.gunzipSync(buffer, { maxOutputLength: MAX_ACTIVITY_FILE_BYTES });
}

async function decodeActivityFile(buffer, fileName) {
    const lower = String(fileName || '').toLowerCase();
    const decodedBuffer = decompressActivityBuffer(buffer, lower);
    if (decodedBuffer.length > MAX_ACTIVITY_FILE_BYTES) throw new Error('The linked activity file is too large');
    if (lower.endsWith('.fit') || lower.endsWith('.fit.gz')) return decodeFitActivity(decodedBuffer);
    if (lower.endsWith('.gpx') || lower.endsWith('.gpx.gz')) return decodeGpxActivity(decodedBuffer);
    if (lower.endsWith('.tcx') || lower.endsWith('.tcx.gz')) return decodeTcxActivity(decodedBuffer);
    throw new Error('Unsupported linked activity file type');
}

function buildExportMetadata(row, columns) {
    const fields = [
        'Activity Private Note', 'Activity Gear', 'Athlete Weight', 'Bike Weight', 'Elevation Loss',
        'Elevation Low', 'Elevation High', 'Max Grade', 'Average Grade', 'Perceived Exertion',
        'From Upload', 'Training Load', 'Intensity', 'Recovery', 'Competition', 'Long Run',
        'Total Sets', 'Total Reps', 'Total Steps', 'Total Weight Lifted'
    ];
    return fields.reduce((result, field) => {
        const value = getCsvField(row, columns, field);
        if (value !== '') result[field] = value;
        return result;
    }, {});
}

function buildWorkoutCategory(row, columns) {
    if (toBoolean(getCsvField(row, columns, 'Competition'))) return 'race';
    if (toBoolean(getCsvField(row, columns, 'Long Run'))) return 'long_run';
    return '';
}

function transformStravaExportRow(slug, providerAthleteId, row, columns, decodedFile, importedAt) {
    const sourceActivityId = getCsvField(row, columns, 'Activity ID', 'first');
    const name = getCsvField(row, columns, 'Activity Name', 'first');
    const type = getCsvField(row, columns, 'Activity Type', 'first');
    const parsedDate = parseStravaDate(getCsvField(row, columns, 'Activity Date', 'first'));
    if (!sourceActivityId || !name || !type || !parsedDate) return null;
    const details = decodedFile && decodedFile.details || {};
    const streams = decodedFile || buildStreamPayload([]);
    const id = `strava_export:${sourceActivityId}`;
    const startDate = details.start_date instanceof Date && !Number.isNaN(details.start_date.getTime())
        ? details.start_date
        : parsedDate.date;
    const streamLatlng = streams.stream_latlng || [];
    const activityTypeKey = ActivityTypes.normalizeActivityTypeKey({ type, sport_type: type });
    const distance = toFiniteNumber(getCsvField(row, columns, 'Distance'));
    const elapsedTime = toFiniteNumber(getCsvField(row, columns, 'Elapsed Time'));
    const movingTime = toFiniteNumber(getCsvField(row, columns, 'Moving Time'));
    const transformed = compactObject({
        schema_version: 1,
        activity_key: id,
        intervals_activity_id: id,
        id,
        user_id: slug,
        user_slug: slug,
        provider: 'strava_export',
        provider_athlete_id: providerAthleteId,
        import_source: 'strava_export',
        source_activity_id: sourceActivityId,
        source_filename: getCsvField(row, columns, 'Filename', 'first'),
        source_datapoint_count: Number(streams.datapoint_count || 0),
        source_stream_count: Number(streams.stream_count || 0),
        data_richness_score: Number(streams.datapoint_count || 0),
        export_imported_at: importedAt,
        export_metadata: buildExportMetadata(row, columns),
        upstream_source: 'STRAVA_EXPORT',
        external_id: sourceActivityId,
        name,
        description: getCsvField(row, columns, 'Activity Description', 'first'),
        type,
        sport_type: type,
        activity_type_key: activityTypeKey,
        workout_category: buildWorkoutCategory(row, columns),
        start_date: startDate,
        start_date_local: parsedDate.localIso,
        distance: distance !== undefined ? distance : details.distance,
        elapsed_time: elapsedTime !== undefined ? elapsedTime : details.elapsed_time,
        moving_time: movingTime !== undefined ? movingTime : details.moving_time,
        total_elevation_gain: toFiniteNumber(getCsvField(row, columns, 'Elevation Gain'))
            ?? details.total_elevation_gain,
        total_elevation_loss: toFiniteNumber(getCsvField(row, columns, 'Elevation Loss'))
            ?? details.total_elevation_loss,
        average_speed: toFiniteNumber(getCsvField(row, columns, 'Average Speed')) ?? details.average_speed,
        max_speed: toFiniteNumber(getCsvField(row, columns, 'Max Speed')) ?? details.max_speed,
        average_heartrate: toFiniteNumber(getCsvField(row, columns, 'Average Heart Rate'))
            ?? details.average_heartrate,
        max_heartrate: toFiniteNumber(getCsvField(row, columns, 'Max Heart Rate')) ?? details.max_heartrate,
        average_cadence: toFiniteNumber(getCsvField(row, columns, 'Average Cadence')) ?? details.average_cadence,
        average_watts: toFiniteNumber(getCsvField(row, columns, 'Average Watts')) ?? details.average_watts,
        weighted_average_watts: toFiniteNumber(getCsvField(row, columns, 'Weighted Average Power')),
        max_watts: toFiniteNumber(getCsvField(row, columns, 'Max Watts')) ?? details.max_watts,
        calories: toFiniteNumber(getCsvField(row, columns, 'Calories')) ?? details.calories,
        average_temp: toFiniteNumber(getCsvField(row, columns, 'Average Temperature')) ?? details.average_temp,
        device_name: details.device_name,
        has_heartrate: Boolean(streams.stream_data && streams.stream_data.heartrate)
            || toFiniteNumber(getCsvField(row, columns, 'Average Heart Rate')) !== undefined,
        commute: toBoolean(getCsvField(row, columns, 'Commute')),
        race: toBoolean(getCsvField(row, columns, 'Competition')),
        perceived_exertion: toFiniteNumber(getCsvField(row, columns, 'Perceived Exertion')),
        start_latlng: streamLatlng[0],
        end_latlng: streamLatlng[streamLatlng.length - 1],
        stream_latlng: streamLatlng,
        stream_velocity_smooth: streams.stream_velocity_smooth || [],
        stream_time: streams.stream_time || [],
        stream_data: streams.stream_data || {},
        stream_keys: streams.stream_keys || [],
        stream_requested_keys: streams.stream_keys || [],
        stream_metadata: {
            source: 'strava_export',
            file_type: streams.file_type || null,
            decoder_warnings: streams.warnings || [],
            datapoint_count: Number(streams.datapoint_count || 0)
        },
        stream_resolution: 'high',
        stream_series_type: 'time',
        stream_fetched_at: decodedFile ? importedAt : undefined,
        map_fetched_at: streamLatlng.length ? importedAt : undefined,
        detail_fetched_at: decodedFile ? importedAt : undefined,
        intervals: streams.intervals || [],
        sport_metrics: streams.sport_metrics,
        intervals_metrics: compactObject({
            strava_relative_effort: toFiniteNumber(getCsvField(row, columns, 'Relative Effort')),
            strava_training_load: toFiniteNumber(getCsvField(row, columns, 'Training Load')),
            strava_intensity: toFiniteNumber(getCsvField(row, columns, 'Intensity'))
        }),
        last_synced_at: importedAt
    });
    const sportMetrics = ActivityKpis.extractSportMetrics(transformed);
    if (Object.keys(sportMetrics).length) {
        transformed.sport_metrics = sportMetrics;
    }
    return transformed;
}

function preserveRicherStoredData(existing, incoming) {
    if (!existing || compareActivityRichness(incoming, existing) >= 0) return incoming;
    return Object.assign({}, incoming, {
        source_datapoint_count: existing.source_datapoint_count,
        source_stream_count: existing.source_stream_count,
        data_richness_score: existing.data_richness_score,
        stream_latlng: existing.stream_latlng,
        stream_velocity_smooth: existing.stream_velocity_smooth,
        stream_time: existing.stream_time,
        stream_data: existing.stream_data,
        stream_keys: existing.stream_keys,
        stream_requested_keys: existing.stream_requested_keys,
        stream_metadata: existing.stream_metadata,
        stream_fetched_at: existing.stream_fetched_at,
        map_fetched_at: existing.map_fetched_at,
        detail_fetched_at: existing.detail_fetched_at,
        start_latlng: existing.start_latlng,
        end_latlng: existing.end_latlng,
        intervals: existing.intervals,
        sport_metrics: existing.sport_metrics
    });
}

function getEntrySize(entry) {
    return Number(entry && (entry.uncompressedSize || entry.vars && entry.vars.uncompressedSize) || 0);
}

async function readEntryBuffer(entry, maximumBytes) {
    const declaredSize = getEntrySize(entry);
    if (declaredSize > maximumBytes) throw new StravaExportImportError(
        `Archive entry ${entry.path} is too large`, 413, 'archive_entry_too_large'
    );
    const buffer = await entry.buffer();
    if (buffer.length > maximumBytes) throw new StravaExportImportError(
        `Archive entry ${entry.path} is too large`, 413, 'archive_entry_too_large'
    );
    return buffer;
}

function resolveLinkedEntry(entriesByPath, csvPath, linkedPath) {
    const normalized = normalizeArchivePath(linkedPath);
    const csvPrefix = normalizeArchivePath(csvPath).slice(0, -'activities.csv'.length);
    return entriesByPath.get(normalized.toLowerCase())
        || entriesByPath.get(`${csvPrefix}${normalized}`.toLowerCase())
        || null;
}

async function importStravaExportZipFile(zipPath, slugValue) {
    const slug = normalizeSlug(slugValue);
    if (!slug) throw new StravaExportImportError('A valid user slug is required', 400, 'invalid_slug');
    if (activeImports.has(slug)) throw new StravaExportImportError(
        'A Strava export import is already running for this slug', 409, 'import_in_progress'
    );
    activeImports.add(slug);
    try {
        const connection = await getConnectionStore().findOne({ connection_key: `${PROVIDER}:${slug}` });
        if (!connection || connection.connection_status !== 'connected' || connection.needs_reconnect) {
            throw new StravaExportImportError('An active Intervals.icu connection is required', 409, 'connection_required');
        }
        const directory = await unzipper.Open.file(zipPath);
        if (!directory.files.length || directory.files.length > MAX_ARCHIVE_ENTRIES) {
            throw new StravaExportImportError('The ZIP has an invalid number of entries', 400, 'invalid_archive');
        }
        const files = directory.files.filter((entry) => entry.type !== 'Directory');
        const entriesByPath = new Map(files.map((entry) => [normalizeArchivePath(entry.path).toLowerCase(), entry]));
        const csvEntry = files.find((entry) => normalizeArchivePath(entry.path).toLowerCase().endsWith('activities.csv'));
        if (!csvEntry) throw new StravaExportImportError(
            'The ZIP does not contain activities.csv', 400, 'activities_csv_missing'
        );
        const targetEntries = files.filter((entry) => entry === csvEntry || isSupportedActivityPath(entry.path));
        const targetUncompressedBytes = targetEntries.reduce((total, entry) => total + getEntrySize(entry), 0);
        if (targetUncompressedBytes > MAX_TARGET_UNCOMPRESSED_BYTES) {
            throw new StravaExportImportError('The activity data in this ZIP is too large', 413, 'archive_too_large');
        }
        const csvBuffer = await readEntryBuffer(csvEntry, MAX_CSV_BYTES);
        const rows = parseCsvRows(csvBuffer.toString('utf8'));
        if (rows.length < 2) throw new StravaExportImportError(
            'activities.csv does not contain any activity rows', 400, 'activities_csv_empty'
        );
        const headers = rows[0];
        const columns = createColumnLookup(headers);
        for (const required of ['Activity ID', 'Activity Date', 'Activity Name', 'Activity Type', 'Filename']) {
            if (!columns.has(required)) throw new StravaExportImportError(
                `activities.csv is missing the ${required} column`, 400, 'activities_csv_invalid'
            );
        }

        const store = getIntervalsActivityStore();
        const importedAt = new Date();
        const result = {
            slug,
            csvRows: rows.length - 1,
            inserted: 0,
            updated: 0,
            skipped: 0,
            filesDecoded: 0,
            fileWarnings: 0,
            warnings: []
        };
        for (let index = 1; index < rows.length; index += 1) {
            const row = rows[index];
            const sourceId = getCsvField(row, columns, 'Activity ID', 'first');
            const linkedPath = getCsvField(row, columns, 'Filename', 'first');
            let decodedFile = null;
            if (linkedPath) {
                const linkedEntry = resolveLinkedEntry(entriesByPath, csvEntry.path, linkedPath);
                if (!linkedEntry) {
                    result.fileWarnings += 1;
                    if (result.warnings.length < 25) result.warnings.push({
                        activityId: sourceId, file: linkedPath, message: 'Linked activity file was not found'
                    });
                } else {
                    try {
                        const fileBuffer = await readEntryBuffer(linkedEntry, MAX_ACTIVITY_FILE_BYTES);
                        decodedFile = await decodeActivityFile(fileBuffer, linkedEntry.path);
                        result.filesDecoded += 1;
                        if (decodedFile.warnings && decodedFile.warnings.length) {
                            result.fileWarnings += decodedFile.warnings.length;
                        }
                    } catch (error) {
                        result.fileWarnings += 1;
                        if (result.warnings.length < 25) result.warnings.push({
                            activityId: sourceId, file: linkedPath, message: error.message
                        });
                    }
                }
            }
            const transformed = transformStravaExportRow(
                slug, connection.provider_athlete_id, row, columns, decodedFile, importedAt
            );
            if (!transformed) {
                result.skipped += 1;
                continue;
            }
            const filter = { user_slug: slug, intervals_activity_id: transformed.intervals_activity_id };
            const existing = await store.findOne(filter);
            await store.upsertOne(filter, preserveRicherStoredData(existing, transformed));
            existing ? result.updated += 1 : result.inserted += 1;
        }
        result.deduplication = await reconcileDuplicateActivitiesForSlug(slug, store);
        await recomputeIntervalsKpis(slug);
        await getConnectionStore().updateOne({ connection_key: `${PROVIDER}:${slug}` }, {
            total_activities: result.deduplication.visibleRecords,
            last_import_at: importedAt,
            last_import_summary: result
        });
        return result;
    } finally {
        activeImports.delete(slug);
    }
}

async function saveRequestToTemporaryZip(request, slugValue) {
    const slug = normalizeSlug(slugValue) || 'unknown';
    const temporaryPath = path.join(os.tmpdir(), `strava-export-${slug}-${crypto.randomBytes(12).toString('hex')}.zip`);
    const maximumBytes = getMaxUploadBytes();
    let receivedBytes = 0;
    const limiter = new Transform({
        transform(chunk, encoding, callback) {
            receivedBytes += chunk.length;
            if (receivedBytes > maximumBytes) {
                callback(new StravaExportImportError(
                    `The ZIP exceeds the ${Math.round(maximumBytes / 1024 / 1024)} MB upload limit`,
                    413,
                    'upload_too_large'
                ));
                return;
            }
            callback(null, chunk);
        }
    });
    try {
        await pipeline(request, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
        if (!receivedBytes) throw new StravaExportImportError('The uploaded ZIP is empty', 400, 'empty_upload');
        const handle = await fs.promises.open(temporaryPath, 'r');
        try {
            const signature = Buffer.alloc(4);
            await handle.read(signature, 0, 4, 0);
            if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
                throw new StravaExportImportError('The uploaded file is not a ZIP archive', 400, 'invalid_archive');
            }
        } finally {
            await handle.close();
        }
        return { path: temporaryPath, bytes: receivedBytes };
    } catch (error) {
        await fs.promises.unlink(temporaryPath).catch(() => {});
        throw error;
    }
}

async function removeTemporaryZip(filePath) {
    if (filePath) await fs.promises.unlink(filePath).catch(() => {});
}

module.exports = {
    StravaExportImportError,
    parseCsvRows,
    createColumnLookup,
    getCsvField,
    parseStravaDate,
    buildStreamPayload,
    decodeFitActivity,
    decodeGpxActivity,
    decodeTcxActivity,
    decodeActivityFile,
    transformStravaExportRow,
    preserveRicherStoredData,
    isStravaExportImportActive,
    importStravaExportZipFile,
    saveRequestToTemporaryZip,
    removeTemporaryZip
};
