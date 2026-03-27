# Apollo

Apollo is a server-backed rehearsal tool for musical numbers. It combines:

- a DAW-style editor for building and editing rehearsal projects
- an interactive player for switching mixes and controlling playback during practice

The current product is hosted-mode only. Do not reintroduce or assume a standalone local-only mode unless the task explicitly asks for it.

## Stack And Architecture

- Frontend: React + Vite in [`src/`](/Users/johan/PycharmProjects/Apollo/src)
- Backend: Express + WebSocket + Postgres in [`server/src/`](/Users/johan/PycharmProjects/Apollo/server/src)
- Media storage: server filesystem / Docker volume
- Local browser storage: IndexedDB is still used for autosave, media caching, and pending sync support

Main UI surfaces:

- `HostedDashboard` for project/library entry
- `Editor` for DAW editing
- `PlayerDashboard` for interactive playback and preset-based mixes

## Working Rules

- Keep hosted mode intact. The app currently requires server mode.
- Keep time values in milliseconds in app state and persistence. Convert only at Web Audio boundaries.
- Route project changes through Zustand actions. Do not bypass autosave, undo/redo, or sync flows.
- Preserve export preset behavior, player preset behavior, realtime sync, and recording-lock behavior unless the task explicitly changes them.
- Prefer existing helpers in `src/lib` and `src/utils` over reimplementing audio, collision, export, or sync logic.
- Treat `docs/old/` as historical reference only, not source of truth.

## Run And Verify

- Install deps: `npm install`
- Backend env: `cp server/.env.example server/.env`
- Start local DB: `docker compose up -d db`
- Start backend: `npm run dev:server`
- Start frontend: `npm run dev:https`
- Production build check: `npm run build`
- Full stack smoke test: `npm run dev:full`

Notes:

- `npm test` currently depends on a missing `jsdom` setup and may fail until that is fixed.
- See [`docs/WORKFLOW.md`](/Users/johan/PycharmProjects/Apollo/docs/WORKFLOW.md) for the preferred day-to-day workflow.

## What Not To Touch Casually

- auth/session flow
- Postgres migrations
- export preset semantics
- player-library and playlist behavior
- audio math and pan/gain behavior
- sync protocol and lock handling

If you change any of those, document the reason and verify the affected flow manually.

## Review Expectations

- Call out regressions first, especially in `Editor`, `PlayerDashboard`, `HostedDashboard`, auth, sync, exports, migrations, and env/config changes.
- Flag any change that makes the README, workflow docs, or env examples inaccurate.

## Definition Of Done

- code matches the current hosted architecture
- docs are updated when workflows or behavior change
- `npm run build` passes
- the affected user flow is smoke-tested in npm dev mode and, when relevant, in the Docker stack
