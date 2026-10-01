# Real-Time Financial Dashboard with Dynamic RBAC

Express API + React (Vite) SPA that shows live CoinGecko data and gates both the **UI** and the **API** by role
(Viewer / Trader / Admin), with an admin-only audit trail.

## Quick start

```bash
npm install
npm run start:all        # dev, hot reload  ->  open http://localhost:5173   (API on :8787)
```

```bash
docker compose up --build   # production build  ->  open http://localhost:8080
```

Requires Node ≥ 20 (see `.nvmrc`) or Docker. No account or API key needed.

### Configuration (optional)

Copy `.env.example` to `.env` to override anything. Real environment variables always win; `.env` is git-ignored and
never copied into the Docker image.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | API port (dev). The Vite proxy follows it. |
| `APP_PORT` | `8080` | Docker only: port published on your machine. |
| `JWT_SECRET` | random per start | ≥ 32 chars. Set it to keep sessions across restarts. Too-short values abort startup. |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime. |
| `ALLOW_DEMO_LOGIN` | `true` in dev, `false` in production | Passwordless role switcher. docker-compose turns it on for the demo. |
| `COINGECKO_API_KEY` | – | Free "Demo" key for higher rate limits. |
| `TRUST_PROXY` | – | `1`/`loopback` when behind a reverse proxy (so rate limiting sees real IPs). |

**Windows tip:** Windows reserves TCP port ranges for Hyper-V/WinNAT (they change after restarting Docker/WSL). If you get
"forbidden by its access permissions", run `netsh interface ipv4 show excludedportrange protocol=tcp` and pick a port outside
the list (`PORT=...` or `APP_PORT=...`). The app prints a hint when this happens.

### Scripts

| Command | What it does |
|---|---|
| `npm run start:all` | API + UI in dev mode |
| `npm test` | backend (node:test + supertest) and frontend (vitest) suites |
| `npm run lint` | ESLint (backend + React hooks rules) |
| `npm run test:ci` | lint + tests + production build (what CI runs) |
| `npm run build` | production bundle of the SPA |

## Roles

| Permission | Viewer | Trader | Admin |
|---|:--:|:--:|:--:|
| market data (prices, summary, FX, history) | ✅ | ✅ | ✅ |
| read watchlist / thresholds | ✅ | ✅ | ✅ |
| create / edit / delete watchlist assets | ❌ | ✅ | ✅ |
| change global volatility threshold | ❌ | ❌ | ✅ |
| read audit log | ❌ | ❌ | ✅ |

Seed users (password login at `POST /api/auth/login`): `viewer/viewer123`, `trader/trader123`, `admin/admin123`.
These are demo credentials for a take-home; a real system would use a user store and environment-provided secrets.
The UI role switcher uses `POST /api/auth/demo-login {role}`.

## API

| Route | Needs |
|---|---|
| `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/demo-login` | public |
| `GET /api/auth/me` | any valid token |
| `GET /api/market/prices?ids=&vs=` · `/market/summary` · `/market/fx` · `/market/history/:id?days=&vs=` | `market:read` |
| `GET /api/watchlist` | `watchlist:read` |
| `POST /api/watchlist` · `PATCH /api/watchlist/:id` · `DELETE /api/watchlist/:id` | `watchlist:write` |
| `GET /api/thresholds` / `PUT /api/thresholds` | `thresholds:read` / `thresholds:write` |
| `GET /api/audit` | `audit:read` |

`401` = missing/invalid/expired token. `403` = valid token, insufficient role.

## Project layout

```
backend/src
  config.js          validated environment (one place)
  permissions.js     role -> permission table (single source of truth)
  auth.js            users (scrypt hashes), JWT, authenticate/authorize middleware
  app.js             Express app factory: routes, headers, rate limit, error handling
  marketService.js   CoinGecko client: cache, coalescing, backoff, cooldown, stale, mock
  mockData.js        offline fallback data
  store.js           in-memory watchlist / threshold / audit buffers
  validate.js        input parsing & whitelists
  server.js          process entry: env, listen, graceful shutdown
backend/test         RBAC matrix, token attacks, market service, API behaviour, config, store
frontend/src         React app (components/, api client, permissions, formatting, tests)
```

## Architecture & security notes

- **Deny by default**: `authenticate` is mounted on the whole `/api` router *before* any protected route; each route then
  declares one permission with `authorize(permission)`.
- **JWT**: HS256 pinned on verify (blocks `alg: none`), configurable expiry. The server re-reads the user's role from its own
  directory on every request; the token's `role` claim is never trusted.
- **Passwords**: scrypt with per-user salt, constant-time comparison, same work for unknown users (no timing oracle).
- **Input validation**: whitelists for ids, currencies, ranges; bounded body size; no mass assignment on `PATCH`.
- **HTTP hardening**: `helmet` (CSP etc.), `x-powered-by` off, login rate limiting, no stack traces to clients, access log
  without query strings, headers, bodies or tokens.
- **Rate limiting (CoinGecko)**: 30 s TTL cache → request coalescing → exponential backoff with jitter (honours `Retry-After`)
  → cooldown after repeated 429 → stale cache → deterministic mock data. Every response carries `meta.source`
  (`live | cache | stale | mock`) and the UI shows it.
- **Audit log**: state-changing actions and denied/failed events live in separate bounded buffers, so a low-privilege user
  cannot push real activity out of the log by spamming forbidden requests.
- **Container**: multi-stage build, production deps only, runs as non-root, read-only filesystem, all capabilities dropped,
  `no-new-privileges`, healthcheck, graceful SIGTERM shutdown.
- **Frontend gating** reads the permission list the server returns, hides/disables controls and shows a 🔒 placeholder. A
  "Backend enforcement probe" card proves the server blocks calls even if the UI is bypassed.

## UX features

Skeleton loaders · sortable columns · price-tick flash · "updated Xs ago" + manual refresh · role banner showing what is
allowed/locked · light/dark theme (follows the OS, remembered) · asset search with All/None · two-step delete confirmation ·
audit-log filters · "N assets flagged" on the threshold card · keyboard focus rings and reduced-motion support.

## Known limitations

- State (watchlist, threshold, audit) is in memory: restarting the API resets it. A database would be the next step.
- Single instance only (in-memory state and rate-limit counters are not shared across replicas).
- `npm audit` reports 0 issues in production dependencies; 2 moderate advisories remain in the test runner (`@vitest/mocker`),
  which is never shipped. They need a major Vitest upgrade that requires a newer Node than `.nvmrc`.
- No refresh tokens / token revocation: a stolen token is valid until it expires (default 1 h).
