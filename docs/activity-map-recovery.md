# Activity Map recovery

## Verified on November 14, 2026

- The configured Mapbox public token returned HTTP 401, `Not Authorized - Invalid Token`.
- Railway's `/api/health` returned healthy, using MongoDB. Both required Intervals server secrets were configured.
- Connor's Intervals connection reported 462 cached workouts, no reconnect error, and a last successful sync of August 5, 2026. Public visits have no owner permission and do not initiate synchronization.
- A three-workout summary/preview response took about 0.5 seconds (55 KB). All 462 cached summaries took about 2 seconds across five 100-record pages (1.03 MB). These are individual measurements, not latency guarantees.
- The installed Railway CLI login had expired. Dashboard access also required sign-in.

## Map imagery

The shared Leaflet map switches to OpenStreetMap street tiles after three tile failures, or after five seconds without a successful tile. Routes remain on the map. Native zoom limits prevent requests for nonexistent high-zoom tiles. The user map identifies when fallback street imagery replaces the selected imagery, including satellite.

For the original Mapbox styles and satellite imagery, create a valid public Mapbox token and configure `window.STRAVA_CONFIG.mapboxAccessToken` before loading `js/strava_shared.js`. Restrict it to the deployed origins using Mapbox's URL restrictions. This public browser token is separate from Railway's server-side credentials. Never put a secret `sk.` token in the frontend. The light and dark Leaflet styles and user-page satellite style share the configured token.

OpenStreetMap is a best-effort fallback with visible attribution and normal browser caching. Do not add tile prefetching, bulk downloading, or offline caching. See the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Faster cached-map startup

- Recent summaries still load first, with bounded previews; older summaries load in 100-record pages.
- Connection status and public profile requests run concurrently.
- KPI and ordinary collection requests no longer block the first route. Shared collection links still wait for their requested collection.
- Opening animation uses cached route geometry if telemetry previews are missing. Full telemetry remains available for selected workouts and playback.
- The fixed 3.2-second camera pause is removed on the user map; opening route animation is capped at six seconds. Replay timing is unchanged.
- Cached reads have a 15-second timeout; background sync retains its separate ten-minute timeout.

## Restore Intervals synchronization

The map menu shows the last successful sync and a **Refresh Intervals connection** link when owner access has expired. Follow that link, choose the existing-map option, and enter the same map URL and Intervals athlete ID. Enter the API key only into the HTTPS onboarding page. This returns an owner session and starts synchronization when the map opens. Owner sessions currently expire after eight hours; public visits alone do not keep the cache fresh.

Alternatively, after restoring Railway access, use the service's configured environment to run `npm run intervals:owner-link -- connor`. Open the resulting private owner link yourself. Do not publish it or put it in a ticket or chat. Verify that `/api/intervals/user/connor/status` advances `lastSync` and that new workouts appear.

For unattended updates, configure the existing Intervals webhook flow or implement a separately tested server-side sync worker. Neither is currently configured by this recovery change.

## Key reset checklist

- **Mapbox public token:** confirmed invalid. Replacing a Railway Strava secret will not repair these tiles.
- **Railway CLI login:** renew with `railway login`; this is separate from app variables.
- **Intervals personal API key:** re-enter a replacement through the existing-map onboarding flow, keeping the same athlete ID and slug.
- **PROVIDER_TOKEN_ENCRYPTION_KEY:** do not blindly replace it. Existing provider keys in MongoDB require the current key to decrypt. Rotation needs re-encryption with both keys or re-onboarding affected accounts.
- **OWNER_SESSION_SECRET:** changing it invalidates existing owner links and requires new owner sessions.
- **MongoDB credentials:** health currently confirms a working connection. Coordinate any actual database password reset with the Railway connection string.
- **Strava credentials/subscription:** renewing credentials does not remove Strava's current Standard Tier subscription requirement. Intervals API-key onboarding does not need the Strava application.

Intervals excludes activities obtained through Strava's API from its own activity API. Use a direct recording-device/app integration into Intervals or the existing Strava ZIP import for historical files. References: [Strava developer access](https://developers.strava.com/docs/getting-started/) and [Intervals API access](https://forum.intervals.icu/t/api-access-to-intervals-icu/609).
