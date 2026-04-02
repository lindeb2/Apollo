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
- builds the frontend and serves it through Nginx
- publishes only `web` to the host; `api` stays internal and is reached through the frontend proxy
- uses the same public `WEB_PORT`, `/api`, `/ws`, and `VITE_USE_HTTPS` toggle shape as the npm frontend flow

Use this when:

- you want to test the app the way the local Docker stack runs
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

By default, Apollo uses built-in local DB settings and only reads `DB_PORT` from the root `.env`:

- npm/backend assumes `postgres://apollo:apollo@localhost:DB_PORT/apollo`
- Docker Compose assumes `postgres://apollo:apollo@db:DB_PORT/apollo`

Either mode can still be overridden with `DATABASE_URL` in your shell.

That value tells it where Postgres lives.

Example:

```env
DB_PORT=5432
```

This means:

- use the built-in local `apollo` database on port `5432`

If the backend is running on your machine, Apollo assumes `localhost`.

If the backend is inside Docker Compose, Apollo assumes `db`, which is the Docker service name.
