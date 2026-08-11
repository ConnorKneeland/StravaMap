# Portfolio-Website---GitHub

## Strava authorization and maps

The production map now uses one server-side Strava OAuth application with persistent, per-slug connections. A user authorizes once; later visits check `GET /api/user/:slug/status`, load cached activities immediately, and synchronize in the background. Existing slugs and legacy redirect pages remain unchanged.

See [Shared Strava OAuth Operations Guide](docs/strava-multi-user-oauth.md) for the OAuth flow, endpoints, database fields, migration notes, Railway variables, Strava dashboard setup, and Tim acceptance run.

## Intervals.icu personal API-key proof of concept

The separate Intervals.icu map is available at `icu_map.html?user=<slug>`. Test accounts are manually linked to slugs with an Athlete ID and personal API key. Credentials are verified, encrypted, and stored server-side in a separate provider connection; the existing Strava map and `activities` collection are not migrated or modified by ICU synchronization.

See the [Intervals.icu Proof-of-Concept Operations Guide](docs/intervals-icu-poc.md) for Railway provisioning, owner links, key rotation, security behavior, API routes, and smoke tests. OAuth remains available in the code for a later public onboarding flow but is not required for personal API-key testing.

An authorized ICU-map owner can also use **Import Strava ZIP** to add historical workouts from a Strava account export. The importer reads `activities.csv` and linked FIT/GPX/TCX files into the separate `intervals_activities` collection. It never modifies or deletes the existing Strava `activities` collection; duplicate source records are retained in MongoDB while the richer copy is displayed on the ICU map.

## Static workout widgets

Two full-viewport, animation-free pages render one indexed workout route and a top KPI strip for screenshot-based home-screen or dashboard widgets:

- Strava: `sMap_Widget.html?user=<slug>&index=0`
- Intervals.icu: `iMap_Widget.html?user=<slug>&index=0`

`index` is optional and zero-based: `0` selects the newest workout, `1` the second newest, and so on. The selected activity must contain route data. A parser-blocking backend payload selects and supplies that one activity before the page can finish opening. Nothing is rendered while the polyline is created, the map is fitted without animation, and the initial map tiles load (or their bounded wait elapses), so screenshot widgets receive the finished map as the first visible frame.

## Legacy Strava modes

### Mode 1: Frontend only (legacy fallback)

1. Keep the site as static files.
2. Make sure these files are deployed together:
   - `strava_user.html`
   - `strava_compare.html`
   - `strava_competitions.html`
   - `js/strava_shared.js`
   - `js/strava_animated.js`
3. Open a user page directly in the browser, for example:
   - `strava_user.html?user=connor`
   - `strava_user.html?user=tim`
   - `strava_user.html?user=quinn`
4. No backend or MongoDB is required in this mode. The browser refreshes a Strava access token and queries the Strava API directly.

### Mode 2: Full stack (production path)

1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Configure the variables in `.env.example`
4. Set `MONGODB_URI` for persistent OAuth, sync progress, and webhook retry data
5. Run `npm start`
6. Set `window.STRAVA_CONFIG = { apiBase: 'http://localhost:3000' };` before loading the Strava pages if you want them to use the backend sync mode

If `MONGODB_URI` and legacy `MONGO_URI` are blank, the backend still runs for local development using the in-memory store in `server/db.js`. Production OAuth must use MongoDB so connections survive restarts.

## File Map

### New frontend files

- `js/strava_shared.js`: shared browser library for auth, fetch, polyline decode, charts, tooltips, map rendering, filters, and optional backend helpers
- `js/strava_animated.js`: recent-route animation for the unified user page
- `strava_user.html`: unified per-user map page driven by `?user=slug`
- `strava_compare.html`: multi-user comparison map and analytics page
- `strava_competitions.html`: competition creation and listing page

### New backend files

- `server/db.js`
- `server/models/user.js`
- `server/models/activity.js`
- `server/models/competition.js`
- `server/services/sync.js`
- `server/routes/auth.js`
- `server/routes/activities.js`
- `server/routes/competitions.js`
- `server/index.js`
- `server/migrate_users.js`
- `package.json`
- `.env.example`

### Existing files left in place

- legacy per-user pages such as `strava_connor.html`, `strava_tim.html`, and the older `js/strava_api*.js` files are still in the repo as references and fallbacks

## How Sync Works

- Sync is triggered by page load.
- There are no cron jobs.
- Frontend-only mode refreshes a token in the browser and fetches Strava activities directly.
- Backend mode calls `POST /api/sync/:slug` first, then reads normalized data from the API.

## API Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/users` | List configured users |
| `GET` | `/api/users/:slug` | Get one user |
| `POST` | `/api/users` | Create a user |
| `PUT` | `/api/users/:slug` | Update or upsert a user |
| `POST` | `/api/sync/:slug` | Refresh Strava token and sync activities for one user |
| `GET` | `/api/activities` | Read activities with optional `user`, `type`, `from`, `to`, `limit` filters |
| `GET` | `/api/activities/stats` | Aggregate stats over filtered activities |
| `GET` | `/api/activities/types` | List detected activity types |
| `GET` | `/api/widget/activity-script` | Supply one parser-blocking activity payload for a screenshot widget |
| `GET` | `/api/competitions` | List competitions |
| `POST` | `/api/competitions` | Create a competition |
| `GET` | `/api/competitions/:id` | Read one competition |
| `GET` | `/api/competitions/:id/leaderboard` | Build a leaderboard for one competition |
| `PUT` | `/api/competitions/:id` | Update a competition |
| `DELETE` | `/api/competitions/:id` | Delete a competition |

## Add a New User

### Frontend-only config

Add a new entry to `StravaApp.USER_CONFIGS` in `js/strava_shared.js` with:

- `slug`
- `displayName`
- `title`
- `clientId`
- `clientSecret`
- `refreshToken`
- `lat`
- `lng`
- `pages`
- `color`

### Backend API example

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Casey",
    "slug": "casey",
    "client_id": 123456,
    "client_secret": "replace-me",
    "refresh_token": "replace-me",
    "color": "#17becf",
    "default_lat": 43.1,
    "default_lng": -89.4,
    "num_pages": 10
  }'
```

## MongoDB Atlas Free Tier

1. Create a MongoDB Atlas account.
2. Create a free shared cluster.
3. Create a database user.
4. Add your IP address or use temporary open access while testing.
5. Copy the connection string.
6. Put that string in `MONGO_URI` in `.env`.
7. Run `node server/migrate_users.js` once if you want to seed the current hardcoded users into MongoDB.

## Linking From Existing Pages

Use the new unified page for individual users:

```html
<a href="strava_user.html?user=connor">Connor's Map</a>
<a href="strava_user.html?user=tim">Tim's Map</a>
<a href="strava_compare.html">Compare Users</a>
<a href="strava_competitions.html">Competitions</a>
```
