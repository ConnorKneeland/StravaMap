# Intervals.icu Map Proof-of-Concept Operations Guide

The proof of concept currently uses Intervals.icu personal API keys instead of OAuth. This avoids OAuth application registration while the map is being tested with a small number of manually approved accounts.

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

Intervals.icu personal API keys use HTTP Basic authentication. The username is the literal value `API_KEY` and the password is the personal API key. The server uses `/api/v1/athlete/0` to verify that the key belongs to the Athlete ID supplied during provisioning.

After verification, the server:

- Links the Intervals.icu Athlete ID to one approved user slug.
- Encrypts the personal API key with AES-256-GCM in `provider_connections`.
- Stores `auth_type: "api_key"` so synchronization uses Basic authentication.
- Rejects an Athlete ID already assigned to another slug.
- Rejects replacing an existing slug with a different athlete, preventing activity data from two accounts from being mixed.
- Produces a signed owner link that is valid for eight hours.

The personal API key is never included in a map URL, returned by an API endpoint, or sent to the browser. Personal API keys are more powerful than an OAuth `ACTIVITY:READ` token; although this code calls only activity read endpoints, keys must be handled like passwords.

## Permanent Railway variables

Add these variables to the Railway service:

```text
INTERVALS_ENABLED_SLUGS=connor
PROVIDER_TOKEN_ENCRYPTION_KEY=<at least 32 random characters>
OWNER_SESSION_SECRET=<a different value with at least 32 random characters>
INTERVALS_SYNC_OLDEST=1970-01-01
FRONTEND_BASE_URL=https://fluffy-druid-f9a1d0.netlify.app
```

List every approved ICU slug in `INTERVALS_ENABLED_SLUGS`, separated by commas. For example:

```text
INTERVALS_ENABLED_SLUGS=connor,matthew,testaccount
```

Do not use `*` in production. Generate independent random values for the encryption and owner-session secrets. Do not reuse a MongoDB password, Strava secret, API key, or OAuth-state secret.

The following OAuth variables are not required for API-key testing:

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

Never paste the API key into GitHub, a frontend file, a map URL, chat, or a shell command argument. If it is exposed, regenerate it immediately in Intervals.icu.

## Provision one slug

First, add the slug to `INTERVALS_ENABLED_SLUGS` and allow Railway to deploy that variable change.

Next, temporarily add these three variables to the Railway service:

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

Repeat this process with a different enabled slug and that account's own Athlete ID and API key to test another Intervals.icu account.

## Create another owner link

Owner browser sessions expire after eight hours. To authorize the browser again, open the Railway service shell and run:

```sh
npm run intervals:owner-link -- connor
```

Replace `connor` with the provisioned slug. The command reads the encrypted connection from MongoDB and prints a new short-lived owner link. It does not print or decrypt the API key into the shell output.

Anyone without a current owner link can still view cached map data, but cannot synchronize, change line styles, edit activity types, add notes, or mutate collections.

The ICU map allows up to ten minutes for background synchronization and large cached-map reads. The normal Strava map retains its shorter request timeout. Background-sync failures are handled immediately while cached routes remain visible. A browser timeout does not roll back a server-side synchronization or a completed ZIP import, but the ICU-specific allowance prevents a healthy long-running sync from appearing as an uncaught console error.

## Initial synchronization and smoke test

1. Deploy the GitHub changes to Railway and Netlify. Deployment does not initiate an ICU sync.
2. Confirm `/api/health` reports `intervals.configured: true` and lists the intended enabled slugs.
3. Provision the account and remove the temporary setup variables.
4. Open the generated owner link.
5. Monitor `GET /api/intervals/user/<slug>/status` and Railway logs until `backfillComplete` is true.
6. Compare `totalActivities` with the eligible directly sourced activity count in Intervals.icu. Hidden responses, incomplete responses, and records with `source: "STRAVA"` are intentionally excluded.
7. Verify recent playback, charts, details, intervals, line settings, notes, collections, shared collections, and Garmin attribution.
8. Open the normal URL in a private browser window and confirm that cached data is public but all mutation controls are read-only.
9. Exercise both provider URLs and confirm the Strava map is unchanged:

```text
https://fluffy-druid-f9a1d0.netlify.app/strava_user.html?user=connor
https://fluffy-druid-f9a1d0.netlify.app/icu_map.html?user=<slug>
```

No migration command is needed. In particular, do not rerun the Strava primary-OAuth campaign for this provider.

## Import historical activities from a Strava export

An authorized owner can add historical Strava-export workouts to the ICU map without changing the existing Strava map or its MongoDB data:

1. Open the current owner link for the slug so the browser has a valid owner session.
2. Open the map menu and select **Import Strava ZIP**.
3. Choose the original ZIP downloaded from Strava. Do not extract or rearrange it first.
4. Leave the page open while the browser uploads the file and the server processes it. The map reloads after a successful import.

The importer reads `activities.csv` and the linked workout files under `activities/`. It supports FIT, compressed FIT, GPX, compressed GPX, and TCX workout files. Photos, profile data, and other account-export content are ignored. The CSV supplies activity titles and summary metadata; activity files supply the detailed route and metric streams used by the map.

Import behavior is deliberately non-destructive:

- Imported workouts are written only to `intervals_activities`, with `provider: "strava_export"` and an ID based on the Strava export Activity ID.
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
2. Temporarily restore the three `INTERVALS_SETUP_*` Railway variables.
3. Run `npm run provision:intervals-api-key` again.
4. Delete the temporary variables again.
5. Open the newly generated owner link.

Provisioning intentionally refuses to attach a different Athlete ID to a slug that already contains another account's data. Use a new slug for a different account. Deleting or reassigning an existing connection and its cached activities should be handled as a separate, deliberate administrative operation.

## Access behavior

- Anyone with a slug URL can read cached ICU map data.
- Synchronization and mutations require a valid signed owner browser session.
- Full synchronization reconciles provider IDs and deletes only missing records from that slug in `intervals_activities`.
- Full synchronization excludes `strava_export` records from provider deletion reconciliation.
- Intervals.icu activity IDs remain strings throughout the API and browser.
- The existing Strava `activities` collection is never read, written, or deleted by ICU synchronization or Strava-export import.
- A Strava webhook deletion is retained as an upstream-deleted marker instead of removing the stored workout document.
- API-key testing uses manual synchronization rather than the OAuth application's webhook flow.

## MongoDB collections

- `intervals_activities`: normalized Intervals.icu map records
- `provider_connections`: encrypted provider credentials and synchronization state
- `intervals_activity_kpi_snapshots`: provider-specific KPI summaries

The existing Strava `activities` and `activity_kpi_snapshots` collections are not used by ICU synchronization.

## Useful endpoints

```text
GET   /api/intervals/user/:slug/status
POST  /api/intervals/sync/:slug
POST  /api/intervals/import/strava-export/:slug
GET   /api/intervals/activities?user=:slug
GET   /api/intervals/activities/:id?user=:slug
GET   /api/intervals/activities/:id/streams?user=:slug
PATCH /api/intervals/activities/:id?user=:slug
```

Owner-only requests use `Authorization: Bearer <owner-session-token>`. That token authorizes map operations only; it is not the Intervals.icu API key.

OAuth callback and webhook routes remain in the code for a future registered OAuth application, but they are not part of the current API-key rollout.
