# Shared Strava OAuth Operations Guide

## Architecture

All new authorizations use Connor's primary Strava API application. The map slug remains the application identity, while `strava_id` remains the Strava athlete identity. They are independently stored and checked on every OAuth callback and sync.

Existing per-user credentials remain in their current files and database fields for migration safety. A legacy user with a stored refresh token remains connected and is not forced through OAuth just to view cached data. The next required reconnect uses the primary application and marks `oauth_application` as `primary` and `migration_status` as `complete`.

## One-time connection flow

1. The map page reads its unchanged `?user=slug` value.
2. It calls `GET /api/user/:slug/status`.
3. A connected slug loads its cached map immediately. Sync starts in the background.
4. An unconnected slug sees **Connect with Strava**. A revoked/invalid token sees **Reconnect Strava**.
5. `GET /api/strava/connect/:slug` verifies the slug and skips Strava entirely if it is already connected.
6. For an unconnected slug, the server stores a ten-minute, signed, nonce-bearing OAuth state record and redirects to the primary Strava app with `approval_prompt=auto` and `scope=read,activity:read_all`.
7. The callback atomically claims the unused state, exchanges the code server-side, rejects slug/athlete mismatches, stores rotated tokens, consumes the state, and returns to the same map slug.
8. Later visits repeat only the status check. OAuth appears again only after revocation or a permanent refresh failure.

The frontend passes its current `strava_user.html` URL as `return_url`. Only the configured frontend origin, the current Netlify origin, the API origin, and localhost in non-production environments are accepted, preventing an open redirect.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/user/:slug/status` | Public, token-free connection and sync status |
| `GET` | `/api/strava/connect/:slug` | Skip OAuth for connected slugs or start primary-app OAuth |
| `GET` | `/api/strava/callback` | Validate one-time state and bind primary-app tokens |
| `POST` | `/api/sync/:slug` | Backfill or incrementally sync one isolated slug |
| `GET` | `/api/sync/:slug/status` | Read progress, retry, and backfill state |
| `GET` | `/api/strava/webhook` | Strava subscription challenge verification |
| `POST` | `/api/strava/webhook` | Queue an activity event and return immediately |

Activity list, detail, stream, and editing routes now require a user scope. Public user responses omit client secrets and all access/refresh tokens.

## Database additions

User records retain all legacy fields and add:

- `granted_scopes`
- `connection_status`, `connected_at`, `needs_reconnect`
- `oauth_application`, `migration_status`
- `last_successful_sync_at`
- `sync_status`, `sync_progress`, `sync_error`, `sync_retry_at`, `sync_backoff_attempts`
- `backfill_complete`

`OAuthState` stores only a SHA-256 hash of the signed state plus slug, nonce, expiration, safe return URL, claim time, and consumption time. Expired records have a TTL cleanup index.

`WebhookEvent` persists deduplicated events, attempts, next retry time, error, and completion state.

Run `npm run migrate:users` after setting the production MongoDB URI. The migration only adds/infer connection metadata and upserts the existing configured user fields. It does not delete activities, change slugs, or remove/rotate existing credentials.

To move a still-valid legacy user onto the primary app, run the targeted command in the Railway service environment:

```bash
npm run migrate:primary-oauth -- michael
```

This preserves Michael's current tokens and data but marks his slug `reconnect_required`. On his next map visit he sees **Reconnect Strava** once. The callback replaces the stored tokens with primary-app tokens only after Strava confirms that the authorizing athlete matches Michael's existing athlete ID. Multiple slugs may be supplied in one command.

## Synchronization behavior

- Initial backfill reads 200 activities per page until Strava returns a short page. `sync_progress.next_page` is saved after every page so an interrupted backfill resumes safely.
- Incremental sync starts from the newest cached activity minus a 24-hour overlap window.
- Activities are upserted by Strava activity ID only after the returned athlete is checked against the slug's bound athlete.
- A cross-slug activity overwrite is rejected before the write.
- Expiring access tokens refresh automatically. Primary-linked users use only the primary app credentials. Legacy records continue to use their existing app credentials until migrated.
- A 400/401 refresh failure marks only that slug `reconnect_required`. A 429 response records exponential backoff instead of forcing reconnect.
- Webhooks are acknowledged immediately, processed asynchronously, and retried from the persistent event queue up to ten attempts.

## Railway checklist

Set all of the following in the production Railway service:

- `APP_BASE_URL=https://stravamap-production-7f28.up.railway.app`
- `STRAVA_REDIRECT_URI=https://stravamap-production-7f28.up.railway.app/api/strava/callback`
- `PRIMARY_STRAVA_CLIENT_ID`
- `PRIMARY_STRAVA_CLIENT_SECRET`
- `MONGODB_URI` (legacy `MONGO_URI` is still accepted during migration)
- `OAUTH_STATE_SECRET` with at least 32 random characters
- `STRAVA_WEBHOOK_VERIFY_TOKEN`
- `NODE_ENV=production`

Optional: set `FRONTEND_BASE_URL=https://fluffy-druid-f9a1d0.netlify.app` explicitly.

After deployment, `GET /api/health` reports booleans for every required configuration item without returning secret values. Production startup and OAuth refuse a localhost callback.

## Strava dashboard checklist

In Connor's Strava API application, confirm:

- Authorization Callback Domain: `stravamap-production-7f28.up.railway.app`
- Requested scope: `read,activity:read_all`
- Webhook callback: `https://stravamap-production-7f28.up.railway.app/api/strava/webhook`

The callback domain is a dashboard setting and cannot be changed or proven by repository tests; confirm it in Strava before the first live authorization.

## Tim production acceptance run

1. Deploy the backend and run the migration.
2. Open `https://fluffy-druid-f9a1d0.netlify.app/strava_user.html?user=tim`.
3. Confirm a tokenized Tim goes directly to the map. If not connected, complete **Connect with Strava** once on Tim's computer.
4. Confirm the callback returns to the same `?user=tim` map URL with `connected=1` once.
5. Check `GET /api/sync/tim/status` until `syncStatus` is `ready` and `backfillComplete` is `true`.
6. Verify Tim's cached activity count and several known routes before and after sync.
7. Close the browser, reopen the unchanged URL, and confirm no connect screen appears.
8. Create or update a Tim activity and confirm the webhook causes it to appear without affecting another slug.

The automated suite validates the one-time decision, state replay rejection, primary credential refresh, athlete/slug uniqueness, reconnect isolation, initial backfill, incremental overlap, webhook deletion scope, and API token redaction. It intentionally does not use live production tokens or mutate the Strava dashboard.
