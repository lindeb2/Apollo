# Apollo

Apollo is a rehearsal tool for musical numbers before performance. It works both as:

- a DAW-style environment for building rehearsal projects
- an interactive music player for live playback manipulation during practice

The goal is to make rehearsal easier, more musical, and more flexible. Arranger-made virtual instrument tracks can be the baseline, but musicians are encouraged to record and add their own material as well. That helps reduce group-sync problems and makes practice more enjoyable. Apollo is useful for everyone, but especially helpful for performers who learn more by ear than by reading notation.

## Running

The fastest way to run locally is via the compose file:

```
npm run dev:full
```

This starts the application (frontend + backend) and a local PostgreSQL instance.

During development the recommended [workflow](docs/WORKFLOW.md) is to run via npm for a faster feedback loop.

## Tech Stack

- React + Vite
- Tailwind CSS
- Zustand
- Dexie / IndexedDB
- Express
- WebSocket (`ws`)
- PostgreSQL
- Web Audio API
- JSZip

## Repository Layout

```text
src/                 frontend app
server/src/          backend API, WebSocket server, migrations
```

## What Apollo Does

Apollo lets users:

- create and manage rehearsal projects
- import audio material and record new takes directly in the browser
- edit clips non-destructively in a DAW-style timeline
- build and export rehearsal-oriented practice mixes
- switch between multiple preset-based mixes during playback
- use a player view with a library, queues, and playlists for rehearsal use

## Current Product Shape

Apollo is currently a hosted, server-backed application.

Today that means:

- the frontend talks to an API and WebSocket backend
- the backend stores structured data in Postgres
- uploaded media is stored on the server filesystem / media volume
- the browser still uses IndexedDB for local autosave, media caching, and pending sync support

The main app surfaces are:

- `HostedDashboard` for project management
- `Editor` for DAW-style editing
- `PlayerDashboard` for interactive playback and preset-based listening

## Core Capabilities

### DAW And Project Editing

- create server-backed projects
- import ZIP-based projects into the server
- import audio files into tracks
- record directly in the browser
- edit clips in a timeline without destructively changing source media
- organize tracks and groups
- export preset-based rehearsal outputs

### Interactive Player

- browse a rehearsal library
- create and manage playlists
- queue and play preset-based mixes
- switch listening context quickly during playback

### Collaboration And Reliability

- authenticated server sessions
- realtime project sync over WebSocket
- recording locks to avoid conflicting edits
- local browser caching to support smoother hosted workflows

## Local Development

The recommended local workflow is:

1. install dependencies
2. run Postgres in Docker
3. run backend and frontend with npm
4. use Docker only as a final smoke test before pushing

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Backend Env

```bash
cp .env.example .env
```

The backend requires at least:

- `DATABASE_URL` or the shared `DB_*` variables in the root `.env`
- `API_PORT`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

Apollo now assumes OIDC / SSO is the primary login flow, so make sure you set:

- `OIDC_ISSUER` for a real provider, or leave it empty to use the local mock default
- `OIDC_CLIENT_ID`
- `OIDC_REDIRECT_URI` only if you need an explicit override
- `OIDC_CLIENT_SECRET` when your provider requires it
- `OIDC_POST_LOGOUT_REDIRECT_URI` if you want provider logout redirects

The shared root `.env` is used for local npm runs and Docker Compose interpolation.
The example file uses shared database credentials. Apollo uses `localhost` for direct npm backend
runs and `db` inside Docker Compose by default. If you need anything else, set `DATABASE_URL`.

### 3. Start Only The Database

```bash
docker compose up -d db
```

### Local OIDC Sandbox

If you want to learn or test OIDC before you have a real provider, Apollo can run against a local mock OpenID Connect provider.

Start the dev dependencies with:

```bash
npm run dev:oidc:deps
```

That starts:

- `db`
- `oidc-mock` on `http://localhost:9400`

The mock provider is intended for development only. By default it accepts any client ID / secret / redirect URI, and shows a simple login form where you can authorize a test user. Apollo's current Compose setup uses this mock only for local development via the `dev-oidc` profile.
The mock provider is intended for development only. By default it accepts any client ID / secret / redirect URI, and shows a simple login form where you can authorize a test user.

Use these local `.env` values for the sandbox:

```env
PUBLIC_BASE_URL=
OIDC_MOCK_PORT=9400
OIDC_ISSUER=
OIDC_PUBLIC_ISSUER=
OIDC_CLIENT_ID=apollo-dev
OIDC_CLIENT_SECRET=apollo-dev-secret
BOOTSTRAP_LOCAL_LOGIN_ENABLED=true
COOKIE_SECURE=false
```

Then run Apollo in npm dev mode:

```bash
npm run dev:api
npm run dev:web
```

Open your actual app URL, for example `https://localhost:3000` or `https://192.168.x.x:3000`, and click `Sign in with SSO`.

The mock provider has two predefined users:

- `alice@example.com`
- `bob@example.com`

You can also type any `sub` value into the provider form and authorize it directly.

Important: even though `docker compose up` now starts `oidc-mock` locally too, the recommended OIDC flow is still the npm frontend/backend flow above. In this mode both the browser and Apollo backend can consistently reach the mock issuer at `http://localhost:9400`.

### 4. Start The Backend

```bash
npm run dev:api
```

### 5. Start The Frontend

```bash
npm run dev:web
```

### 6. Build Before Commit Or Push

```bash
npm run build
```

### 7. Do A Full Docker Smoke Test Before Push

Stop the npm frontend/backend first, then run:

```bash
npm run dev:full
```

For the fuller explanation of when to use npm vs Docker, read [`docs/WORKFLOW.md`](/Users/johan/PycharmProjects/Apollo/docs/WORKFLOW.md).

## Full Docker Stack

For a full local Docker run, Apollo includes a Compose stack with:

- `db` for PostgreSQL
- `oidc-mock` for local OIDC testing
- `api` for the backend
- `web` for the frontend on the Node/Vite port

Start it with:

```bash
npm run dev:full
```

Or run it directly:

```bash
docker compose up
```

`oidc-mock` is part of the local Compose stack for convenience, but it is still a local development dependency, not something intended to be packaged or shipped as part of the production app release.

If you want both npm and Docker to use an external database, update the shared DB values in the
root `.env` and set both hosts to that server. For a temporary Docker-only override, set
`DATABASE_URL` in your shell and start only the app services:

```bash
DATABASE_URL=postgres://user:password@host:5432/database docker compose up api web
```

Default example credentials in the checked-in env/docker config are:

- username: `admin`
- password: `changemechangeme`

Change secrets and default credentials before any real deployment.

## OIDC / SSO

Apollo now supports generic OpenID Connect login with discovery-based configuration.

- normal hosted sign-in can be handled by OIDC
- Apollo still keeps app-local authorization in Postgres (`is_admin`, project permissions, ownership)
- first OIDC login creates a disabled local Apollo user until an admin activates or links that identity
- a local bootstrap admin login can stay enabled for first activation and recovery

Recommended rollout order:

1. learn the flow with the local mock provider
2. activate and link users through Apollo's admin UI
3. switch to a real provider only after the login and approval flow feels clear

Important production notes:

- OIDC and cookie-based sessions should be run behind real HTTPS
- set `VITE_USE_HTTPS=false` in prod because HTTPS should terminate at the shared reverse proxy
- set `COOKIE_SECURE=true` in production
- make sure your OIDC provider redirect URI matches `/api/auth/oidc/callback`
- WebSocket auth now relies on the same session cookies as the REST API

## Release Images

On release tags like `v1.2.3`, GitHub Actions publishes Docker images to GHCR for:

- `api`
- `web`

Those published images are the release container images. The automatic GitHub release source
archives (`zip` / `tar.gz`) are only source code snapshots.

## Verification

Useful commands:

```bash
npm run build
npm run dev:full
```

`npm test` exists, but the current Vitest setup still needs `jsdom` before that command is reliable in this repo.

## License

MIT
