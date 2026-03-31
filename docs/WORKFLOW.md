# Apollo Workflow

### Instant feedback during work

```bash
# start postgres, not needed if external pg
docker compose up -d db
```

```bash
# start backend
npm run dev:server
```

```bash
# start frontend
npm run dev:https
```

- npm processes only need to be restarted if config/env/startup is changed.
- if done working:
  - stop the npm processes with `Ctrl + C`
  - stop postgres with `docker compose stop db`

### Before commit

```bash
npm run build
```

### Before push

- stop the npm processes if still running
  - `Ctrl + C` to stop
- start whole docker stack with:

```bash
npm run dev:full
```

- smoke test the app

> If done working:
> 
> ```bash
> docker compose stop
> ```
> 
> If continuing working:
> 
> ```bash
> docker compose stop web api
> ```

### Docker-only local run

```bash
# use local postgres in Docker
docker compose up
```

```bash
# use an external postgres and skip the local db container
DATABASE_URL=postgres://user:password@host:5432/database docker compose up api web
```


## When You Should Use Docker Immediately

Use Docker earlier if your change touches:

- nginx or proxy behavior
- Dockerfiles
- Docker Compose
- environment variables
- networking
- file paths or mounted volumes
- production-only behavior

## When You Usually Do Not Need Docker Yet

You usually do not need Docker for every edit if you are changing:

- React UI
- buttons
- forms
- layout
- simple API handler logic
- small frontend behavior
- small backend behavior

#
#
#
## Commands Explained


```bash
npm install
```

What it does:

- Downloads the JavaScript packages the app needs.
- Creates the `node_modules` folder.
- You usually run this after cloning the repo or after dependencies change.

#
```bash
npm run dev:server
```

- Starts the backend server from the `server` folder.
- Watches for file changes.
- Restarts the backend automatically when backend code changes.
- Connects to PostgreSQL using `DATABASE_URL`.

#
```bash
npm run dev:https
```

What it does:

- Starts the frontend Vite dev server
- serves it over HTTPS
- sets the frontend env vars needed for server mode
- proxies `/api` and `/ws` traffic to the backend

#
```bash
npm run dev
```

What it does:

- Starts the plain Vite frontend dev server

Important:

- this is only useful if you already provided the needed frontend env vars yourself
- for this repo, `npm run dev:https` is usually the safer default

#
```bash
npm run build
```

What it does:

- Builds the frontend for production
- creates the `dist/` folder
- catches many frontend build errors before you commit / push

#
```bash
npm run preview
```

What it does:

- serves the already-built `dist/` folder locally
- lets you inspect the frontend production build in a browser

Use this when:

- you want to see what the built frontend looks like
- you already ran `npm run build`

#
```bash
npm run dev:full
```

What it does:

- runs the helper script at `scripts/dev-full.sh`
- generates local certs if needed
- starts the full Docker Compose stack
- builds containers if needed
- starts:
  - `web`
  - `api`
  - `db`

Use this when:

- you want to test the app the way the full stack runs
- you want to catch Docker, proxy, or container-related problems
- you want a final confidence check before pushing

This is slower than the normal `npm` workflow, so do not use it for every tiny edit.

#
```bash
npm test
```

What it does:

- runs the Vitest test suite

Important note:

- at the moment this repo is missing `jsdom`, so this command may fail until the test setup is fixed

That means:

- `npm run build` is currently the more reliable quick verification command

#
```bash
npm run server:start
```

What it does:

- starts the backend once without watch mode
- this is closer to how a normal production process runs

Use this when:

- you want to run the backend without automatic restarts

#
```bash
npm run cert:lan
```

What it does:

- generates local certificates for HTTPS development

Use this when:

- local certs are missing
- you want to test on another device on your network

#
#
#
### Where the backend looks for the database

Default value in the root `.env`, but it can be overridden with `DATABASE_URL` in your shell.

By default, both npm and Docker Compose read the same shared DB settings from the root `.env`:

- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`

The normal local difference is only the host:

- npm/backend uses `DB_HOST_LOCAL`
- Docker Compose uses `DB_HOST_DOCKER`

Docker Compose can still be temporarily overridden with `DATABASE_URL` in your shell.

That value tells it where Postgres lives.

Example:

```env
DB_PROTOCOL=postgres
DB_USER=apollo
DB_PASSWORD=apollo
DB_NAME=apollo
DB_PORT=5432
DB_HOST_LOCAL=localhost
DB_HOST_DOCKER=db
```

This means:

- use PostgreSQL
- username is `apollo`
- password is `apollo`
- port is `5432`
- database name is `apollo`

If the backend is running on your machine, `localhost` means your machine.

If the backend is inside Docker Compose, the host is different. In Docker Compose it uses:

```env
DB_HOST_DOCKER=db
```

There, `db` is the Docker service name.
