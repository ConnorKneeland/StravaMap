# Intervals.icu Map Operations Guide

The Intervals.icu map uses personal API keys for a small friends-and-family onboarding flow. This avoids requiring a registered OAuth application while still verifying each Intervals.icu account before it can be connected.

Start onboarding at:

```text
https://fluffy-druid-f9a1d0.netlify.app/intervals_new_user.html
```

Each Intervals.icu account is assigned its own public map slug:

```text
https://fluffy-druid-f9a1d0.netlify.app/icu_map.html?user=<slug>
```

For example:

```text
https://fluffy-druid-f9a1d0.netlify.app/icu_map.html?user=connor
https://fluffy-druid-f9a1d0.netlify.app/icu_map.html?user=matthew
```

The corresponding Strava URLs and Strava synchronization remain unchanged.

## What the API-key flow does

Intervals.icu personal API keys use HTTP Basic authentication. The username is the literal value `API_KEY` and the password is the personal API key. The server uses `/api/v1/athlete/0` to verify that the key belongs to the Athlete ID supplied during onboarding.

After verification, the server:

- Links the Intervals.icu Athlete ID to one stored user slug.
- Encrypts the personal API key with AES-256-GCM in `provider_connections`.
- Stores `auth_type: "api_key"` so synchronization uses Basic authentication.
- Rejects an Athlete ID already assigned to another slug.
- Rejects replacing an existing slug with a different athlete, preventing activity data from two accounts from being mixed.
- Returns a signed owner link that is valid for eight hours.

The personal API key is accepted only in the HTTPS registration request. It is never included in a map URL, returned by an API endpoint, or logged by the application. Personal API keys are more powerful than an OAuth `ACTIVITY:READ` token; although this code calls only activity read endpoints, keys must be handled like passwords.

## Permanent Railway variables

Add these variables to the Railway service:

```text
PROVIDER_TOKEN_ENCRYPTION_KEY=<at least 32 random characters>
OWNER_SESSION_SECRET=<a different value with at least 32 random characters>
INTERVALS_SYNC_OLDEST=1970-01-01
FRONTEND_BASE_URL=https://fluffy-druid-f9a1d0.netlify.app
```

Generate independent random values for the encryption and owner-session secrets. Do not reuse a MongoDB password, Strava secret, API key, or OAuth-state secret.

Personal API-key onboarding does not use `INTERVALS_ENABLED_SLUGS`. Once a verified connection is stored, that slug is eligible for the Intervals map, status, sync, and widget routes. The variable remains only as an optional rollout control for the legacy Connor-only OAuth path.

The following OAuth variables are not required for personal API-key onboarding:

```text
INTERVALS_CLIENT_ID
INTERVALS_CLIENT_SECRET
INTERVALS_REDIRECT_URI
INTERVALS_CONNOR_ATHLETE_ID
INTERVALS_WEBHOOK_SECRET
```

`GET /api/health` reports `intervals.configured: true` when the two server-side security secrets are ready. It separately reports whether optional OAuth and webhook support are configured.

## Find the Athlete ID and personal API key

The account owner must sign in to Intervals.icu and open **Settings → Developer Settings**. Copy:

1. The Intervals.icu Athlete ID exactly as displayed. Some IDs begin with `i`; older IDs might not.
2. The personal API key.

Enter the key only on the onboarding page. Never paste it into GitHub, a frontend file, a map URL, chat, or a shell command argument. If it is exposed, regenerate it immediately in Intervals.icu.

## Onboard a map

Open `intervals_new_user.html` and choose one of the two paths:

- **I have an existing map:** Paste the entire existing Make Your Map URL. The page extracts the `user` value automatically, and the user must confirm that the URL belongs to them. The map ID must already exist in the `users` collection. Connecting Intervals.icu does not alter that user's Strava credentials, map settings, or Strava activities.
- **I want to make a map for myself:** Enter a first and last name and agree to create the map. The server derives the lowercase `firstnamelastname` slug using the same validation and defaults as Strava onboarding.

Both paths require the Intervals.icu Athlete ID, personal API key, and their mode-specific confirmation checkbox. On submit, `POST /api/intervals/register` verifies the confirmation and the key/athlete match before creating or changing records. A new-user failure leaves no partial user or provider connection. Re-entering the same slug and Athlete ID is allowed and rotates the stored key; changing the athlete assigned to a slug is refused.

After registration, the browser opens the returned owner link. The owner token is placed in `sessionStorage` and removed from the visible URL immediately. The map then performs the initial synchronization and caches the results in MongoDB for future visits.

## Administrative provisioning fallback

The command-line provisioner remains available for recovery or administration. Temporarily add these three variables to the Railway service:

```text
INTERVALS_SETUP_SLUG=connor
INTERVALS_SETUP_ATHLETE_ID=<the exact Intervals.icu Athlete ID>
INTERVALS_SETUP_API_KEY=<the personal API key>
```

Open the Railway service shell and run:

```sh
npm run provision:intervals-api-key
```

The command will:

1. Call Intervals.icu with Basic authentication.
2. Verify that `/athlete/0` returns the expected Athlete ID.
3. Encrypt and save the key in MongoDB.
4. Print the slug, verified athlete information, authentication type, and an `ownerLink`.

It never prints the personal API key. If the Athlete ID and key do not match, no connection is saved.

Copy the `ownerLink`, then immediately delete all three `INTERVALS_SETUP_*` variables from Railway and let Railway redeploy. Deleting them does not remove the encrypted MongoDB connection.

Open the owner link in the browser that should be allowed to synchronize and edit the map. The signed owner token is placed in `sessionStorage` and removed from the visible URL immediately. Opening the connected map starts the initial synchronization; provisioning by itself does not start a sync.

## Create another owner link

Owner browser sessions expire after eight hours. The user can submit the existing-map onboarding path again with the same slug, Athlete ID, and API key to receive a new owner session. This also safely replaces the encrypted copy of the same key.

An administrator can instead open the Railway service shell and run:

```sh
npm run intervals:owner-link -- connor
```

Replace `connor` with the provisioned slug. The command reads the encrypted connection from MongoDB and prints a new short-lived owner link. It does not print or decrypt the API key into the shell output.

Anyone without a current owner link can still view cached map data, but cannot synchronize, change line styles, edit activity types, add notes, or mutate collections.

The ICU map allows up to ten minutes for background synchronization. Cached-map reads use small cursor-paginated summary pages, so they no longer depend on that extended timeout. Background-sync failures are handled immediately while cached routes remain visible. A browser timeout does not roll back a server-side synchronization or a completed ZIP import.

## Initial synchronization and smoke test

1. Deploy this Railway server with `ACTIVITY_LIST_V2_ENABLED` unset or `false`. The migration command and new storage are available, but existing frontend clients continue receiving the old bare-array list response.
2. Run `npm run migrate:activity-streams -- --provider=intervals` in the Railway shell and review the read-only candidate and required-index report.
3. Run `npm run migrate:activity-streams -- --provider=intervals --apply`. The unique stream-identity and compound pagination indexes are created and re-verified before telemetry writes begin. Each stream copy is hash-verified and compact route/preview fields are populated, while legacy arrays remain available for rollback. Optimistic timestamp checks reread and retry if a live sync or import changes either record. An index failure or equal-length conflicting stream arrays abort safely without cleanup.
4. Deploy the compatible static frontend to Netlify and verify its CDN cache. This frontend requests `activity_list_version=2` explicitly, while older cached clients remain on the bare-array response.
5. Set `ACTIVITY_LIST_V2_ENABLED=true` in Railway and redeploy to make lightweight cursor pagination the unversioned default. Do this only after the copy pass, index verification, and compatible frontend all succeed.
6. Confirm `/api/health` reports `intervals.configured: true`.
7. Open `intervals_new_user.html` and complete one onboarding branch.
8. Confirm the browser redirects to the generated owner map URL.
9. Monitor `GET /api/intervals/user/<slug>/status` and Railway logs until `backfillComplete` is true.
10. Compare `totalActivities` with the eligible directly sourced activity count in Intervals.icu. Hidden responses, incomplete responses, and records with `source: "STRAVA"` are intentionally excluded.
11. Verify recent playback, charts, details, intervals, line settings, notes, collections, shared collections, and Garmin attribution.
12. Open the normal URL in a private browser window and confirm that cached data is public but all mutation controls are read-only.
13. Exercise both provider URLs and confirm the Strava map is unchanged:

```text
https://fluffy-druid-f9a1d0.netlify.app/strava_user.html?user=connor
https://fluffy-druid-f9a1d0.netlify.app/icu_map.html?user=<slug>
```

14. After the rollback window, run `npm run migrate:activity-streams -- --provider=intervals --apply --cleanup` to remove the verified duplicate/full arrays from `intervals_activities`. The command performs a final candidate recount and fails if concurrent or old application code reintroduced any legacy arrays; do not consider cleanup complete unless `remaining_candidates` is `0`.

The activity-stream migration is separate from authentication. Do not rerun the Strava primary-OAuth campaign for this provider. Both migration passes are idempotent.

## Import historical activities from a Strava export

An authorized owner can add historical Strava-export workouts to the ICU map without changing the existing Strava map or its MongoDB data:

1. Open the current owner link for the slug so the browser has a valid owner session.
2. Open the map menu and select **Import Strava ZIP**.
3. Choose the original ZIP downloaded from Strava. Do not extract or rearrange it first.
4. Leave the page open while the browser uploads the file and the server processes it. The map reloads after a successful import.

The importer reads `activities.csv` and the linked workout files under `activities/`. It supports FIT, compressed FIT, GPX, compressed GPX, and TCX workout files. Photos, profile data, and other account-export content are ignored. The CSV supplies activity titles and summary metadata; activity files supply the detailed route and metric streams used by the map.

Import behavior is deliberately non-destructive:

- Imported workout summaries are written only to `intervals_activities`, with `provider: "strava_export"` and an ID based on the Strava export Activity ID. Their full telemetry is written only to `intervals_activity_streams`.
- The importer never writes to or deletes from the existing Strava `activities` collection.
- Re-importing the same archive updates the same records and preserves previously stored richer stream data.
- Regular Intervals.icu synchronization neither hydrates nor deletes Strava-export records.
- When an Intervals.icu activity and an imported activity appear to describe the same workout, both records remain in MongoDB. The map exposes the record with the most route and stream datapoints and marks the weaker copy as hidden from normal map reads.

The default maximum ZIP upload is 1 GiB. Set `STRAVA_EXPORT_MAX_ZIP_BYTES` to a byte value only if a different server limit is needed. ZIP entry counts, CSV size, individual activity-file size, and total extracted workout data also have defensive limits. The archive is streamed to a temporary server file rather than loaded completely into memory.

The endpoint used by the button is:

```text
POST /api/intervals/import/strava-export/:slug
Content-Type: application/zip
Authorization: Bearer <owner-session-token>
```

It is owner-only and accepts a raw ZIP request body. The personal Intervals.icu API key is not involved in the browser upload.

## Key rotation and reconnection

If Intervals.icu returns `401` or `403` for a personal API-key connection, the server marks it as requiring reconnection and leaves cached map records readable.

To rotate or replace a key for the same Athlete ID and slug:

1. Generate the replacement key in Intervals.icu.
2. Open `intervals_new_user.html` and choose **I already have a map**.
3. Enter the same slug and Athlete ID with the replacement key.
4. Submit the form and open the returned owner map.

The administrative provisioning command can perform the same rotation when browser onboarding is unavailable.

Provisioning intentionally refuses to attach a different Athlete ID to a slug that already contains another account's data. Use a new slug for a different account. Deleting or reassigning an existing connection and its cached activities should be handled as a separate, deliberate administrative operation.

## Access behavior

- Anyone with a slug URL can read cached ICU map data.
- Synchronization and mutations require a valid signed owner browser session.
- Full synchronization reconciles provider IDs and deletes only missing records from that slug in `intervals_activities`.
- Full synchronization excludes `strava_export` records from provider deletion reconciliation.
- Intervals.icu activity IDs remain strings throughout the API and browser.
- The existing Strava `activities` collection is never read, written, or deleted by ICU synchronization or Strava-export import.
- A Strava webhook deletion is retained as an upstream-deleted marker instead of removing the stored workout document.
- Personal API-key connections synchronize from the owner map rather than using the OAuth application's webhook flow.

## MongoDB collections

- `intervals_activities`: normalized Intervals.icu map records
- `intervals_activity_streams`: canonical full telemetry for native Intervals.icu and imported Strava-export workouts
- `provider_connections`: encrypted provider credentials and synchronization state
- `intervals_activity_kpi_snapshots`: provider-specific KPI summaries

The existing Strava `activities` and `activity_kpi_snapshots` collections are not used by ICU synchronization.

## Useful endpoints

```text
POST  /api/intervals/register
GET   /api/intervals/user/:slug/status
POST  /api/intervals/sync/:slug
POST  /api/intervals/import/strava-export/:slug
GET   /api/intervals/activities?user=:slug&limit=50&cursor=:opaque_cursor
GET   /api/intervals/activities/:id?user=:slug
GET   /api/intervals/activities/:id/streams?user=:slug
PATCH /api/intervals/activities/:id?user=:slug
```

Owner-only requests use `Authorization: Bearer <owner-session-token>`. That token authorizes map operations only; it is not the Intervals.icu API key.

The activity-list endpoint returns `{ activities, pagination }`, never full stream arrays. `limit`
defaults to 50 and is capped at 100; pass `pagination.next_cursor` back as `cursor`. The initial map
request uses `include_preview=1` for a bounded route-aligned preview. Full telemetry is returned once,
under `streams`, only by the provider-specific stream endpoint.

OAuth callback and webhook routes remain in the code for a future registered OAuth application, but they are not part of the current API-key rollout.
