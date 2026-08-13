const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const userMapHtml = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'strava_user.html'),
    'utf8'
);
const comparisonMapHtml = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'strava_compare.html'),
    'utf8'
);

function extractInlineFunction(functionName, nextFunctionMarker, dependencies) {
    const start = userMapHtml.indexOf(`function ${functionName}(`);
    const end = userMapHtml.indexOf(nextFunctionMarker, start);
    assert.ok(start >= 0 && end > start, `Unable to extract ${functionName}`);
    const names = Object.keys(dependencies || {});
    const values = names.map((name) => dependencies[name]);
    return Function.apply(null, names.concat(
        `${userMapHtml.slice(start, end)}; return ${functionName};`
    )).apply(null, values);
}

test('new Intervals maps poll for routed summaries while the initial sync stays in the background', () => {
    assert.match(userMapHtml, /ICU_INITIAL_ROUTE_POLL_TIMEOUT_MS\s*=\s*120000/);
    assert.match(userMapHtml, /isIntervalsProvider\s*&&\s*!activityPageHasDrawableRoute\(activityPage\)/);
    assert.match(userMapHtml, /backgroundSyncPromise\s*=\s*trackedSyncRequest\.catch/);
    assert.match(userMapHtml, /pollForInitialRoutedActivityPage\(activityPage, requestOptions, syncTracker\)/);
    assert.doesNotMatch(userMapHtml, /if \(syncTracker && syncTracker\.error\) \{\s*throw syncTracker\.error/);
    assert.match(userMapHtml, /lastPollError\s*=\s*syncTracker\.error;\s*break;/);
    assert.match(userMapHtml, /syncTracker && syncTracker\.settled\) \{[\s\S]*scanForFirstOlderRoutedActivity/);
});

test('top-three indoor summaries merge the fourth routed workout without moving the background cursor', () => {
    const getActivityId = (activity) => activity && activity.id;
    const mergeRoutedActivityIntoInitialPage = extractInlineFunction(
        'mergeRoutedActivityIntoInitialPage',
        'async function scanForFirstOlderRoutedActivity',
        {
            getActivityId,
            StravaApp: { normalizeActivityRecord: (activity) => Object.assign({}, activity) }
        }
    );
    const pagination = { limit: 3, has_more: true, next_cursor: 'after-top-three' };
    const initialPage = {
        activities: [
            { id: 'indoor-1', name: 'Indoor 1' },
            { id: 'indoor-2', name: 'Indoor 2' },
            { id: 'indoor-3', name: 'Indoor 3' }
        ],
        pagination
    };
    const withFourthRoute = mergeRoutedActivityIntoInitialPage(initialPage, {
        id: 'routed-4', name: 'Fourth workout', summary_polyline: 'encoded-route'
    });
    const withFourthPreview = mergeRoutedActivityIntoInitialPage(withFourthRoute, {
        id: 'routed-4', stream_preview: { latlng: [[44, -93], [44.1, -93.1]] }
    });

    assert.deepEqual(withFourthPreview.activities.map((activity) => activity.id), [
        'indoor-1', 'indoor-2', 'indoor-3', 'routed-4'
    ]);
    assert.equal(withFourthPreview.activities[3].summary_polyline, 'encoded-route');
    assert.deepEqual(withFourthPreview.activities[3].stream_preview.latlng, [[44, -93], [44.1, -93.1]]);
    assert.equal(withFourthPreview.pagination, pagination);
    assert.equal(initialPage.activities.length, 3);
    assert.match(userMapHtml, /limit:\s*50,[\s\S]*cursor:\s*nextCursor/);
    assert.match(userMapHtml, /ids:\s*String\(routedId\),[\s\S]*limit:\s*1,[\s\S]*include_preview:\s*1/);
    assert.match(userMapHtml, /scanForFirstOlderRoutedActivity\([\s\S]*activityPage, requestOptions, 1[\s\S]*\)/);
    assert.match(userMapHtml, /while \(hasMore && pagesScanned < pageLimit\)/);
});

test('hydrated Intervals summaries upsert existing records and refresh after map backfill', () => {
    assert.match(userMapHtml, /item\.activity\s*=\s*StravaApp\.normalizeActivityRecord\(Object\.assign\(\{\}, item\.activity, activity\)\)/);
    assert.match(userMapHtml, /mapsHydrated\s*=\s*Number\(summary\s*&&\s*summary\.mapsHydrated/);
    assert.match(userMapHtml, /refreshActivitySummariesAfterSync/);
});

test('map list consumers opt into V2 for initial and cursor-paginated requests', () => {
    assert.match(userMapHtml, /Object\.assign\(\{\}, query \|\| \{\}, \{ activity_list_version: 2 \}\)/);
    assert.match(userMapHtml, /limit:\s*3,[\s\S]*include_preview:\s*1/);
    assert.match(userMapHtml, /limit:\s*50,[\s\S]*cursor:\s*nextCursor/);
    assert.match(comparisonMapHtml, /limit:\s*100,[\s\S]*activity_list_version:\s*2/);
});

test('public and Strava maps recover an older cached route outside the owner-sync branch', () => {
    const ownerSyncBranch = userMapHtml.indexOf("if (window.STRAVA_CONFIG.syncOnLoad === true && isOwnerWritable())");
    const providerNeutralRecovery = userMapHtml.indexOf(
        "if (!activityPageHasDrawableRoute(activityPage)) {",
        ownerSyncBranch
    );
    const normalizedActivities = userMapHtml.indexOf('const normalizedActivities =', providerNeutralRecovery);
    assert.ok(ownerSyncBranch >= 0);
    assert.ok(providerNeutralRecovery > ownerSyncBranch);
    assert.ok(normalizedActivities > providerNeutralRecovery);
    const recoveryBlock = userMapHtml.slice(providerNeutralRecovery, normalizedActivities);
    assert.match(recoveryBlock, /scanForFirstOlderRoutedActivity\(activityPage, requestOptions\)/);
    assert.match(recoveryBlock, /Provider-neutral recovery/);
});
