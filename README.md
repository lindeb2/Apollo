# Apollo

Apollo is a rehearsal tool for musical numbers before performance. It works both as:

- a DAW-style environment for building rehearsal projects
- an interactive music player for live playback manipulation during practice

The goal is to make rehearsal easier, more musical, and more flexible. Arranger-made virtual instrument tracks can be the baseline, but musicians are encouraged to record and add their own material as well. That helps reduce group-sync problems and makes practice more enjoyable. Apollo is useful for everyone, but especially helpful for performers who learn more by ear than by reading notation.

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
docker-compose.yml   local full-stack Docker setup
docs/WORKFLOW.md     recommended development workflow
docs/old/            historical docs only, not source of truth
```

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
cp server/.env.example server/.env
```

The backend requires at least:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

The example env points the backend at a local Postgres instance on `localhost:5432`.

### 3. Start Only The Database

```bash
docker compose up -d db
```

### 4. Start The Backend

```bash
npm run dev:server
```

### 5. Start The Frontend

```bash
npm run dev:https
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

For a production-like local run, Apollo includes a Docker Compose stack with:

- `db` for PostgreSQL
- `api` for the backend
- `web` for the built frontend and proxy layer

Start it with:

```bash
npm run dev:full
```

Default example credentials in the checked-in env/docker config are:

- username: `admin`
- password: `changemechangeme`

Change secrets and default credentials before any real deployment.

## Verification

Useful commands:

```bash
npm run build
npm run dev:full
```

`npm test` exists, but the current Vitest setup still needs `jsdom` before that command is reliable in this repo.

## License

MIT
