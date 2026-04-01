# Apollo Workflow

### Instant feedback during work

```bash
# start local postgres and local openidconnect-mock
docker compose up -d db oidc-mock
```

```bash
# start backend
npm run dev:api
```

```bash
# start frontend
npm run dev:web
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
# use local postgres and mock-oidc in docker
npm run dev:full
```

```bash
# use an external postgres and skip the local db container
DATABASE_URL=postgres://user:password@host:5432/database docker compose up api web
```


## When You Should Use Docker Immediately

Use Docker earlier if your change touches:

- proxy behavior
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

- Reads `package.json`
- Downloads the JavaScript packages the app needs.
- Creates the `node_modules` folder.

#
```bash
npm run dev:api # npm --workspaces=false --prefix server run dev
```

- Starts the backend server from the `server` folder.
- Watches for file changes.
- Restarts the backend automatically when backend code changes.

#
```bash
npm run dev:web # ./scripts/dev-web.sh
```

- runs `generate-lan-cert.sh` only when `VITE_USE_HTTPS=true`
- starts the frontend Vite dev server
- reads frontend settings from the shared root `.env`
- proxies `/api` and `/ws` traffic to the backend using those env values

#
```bash
npm run build
```

- Builds the frontend for production in the `dist/` folder

#
```bash
npm run dev:full # scripts/dev-full.sh
```

- runs `generate-lan-cert.sh` only when `VITE_USE_HTTPS=true`
- starts the full Docker Compose stack
  - `web`
  - `api`
  - `db`

Use this when:

- you want to test the app the way the full stack runs
- you want to catch Docker, proxy, or container-related problems
- you want a final confidence check before pushing

#
```bash
npm test
```

What it does:

- runs the Vitest test suite

#
```bash
npm run cert:lan # generate-lan-cert.sh
```

Use this when:

- local dev runs with `VITE_USE_HTTPS=true`
- you want mic/OIDC to work from another device on your network

#
#
#
### Database

By default, both npm and Docker Compose read the same shared DB settings from the root `.env`, but it can be overridden with `DATABASE_URL` in your shell.:

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
