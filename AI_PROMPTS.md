# AI_PROMPTS.md

> Built with Claude Code. Below are the prompts that drove the project and the problems the AI's own output had that were caught by tests / review.
> **Note to author:** replace or extend the prompts with your own wording if you used different ones.

## Key prompts

1. **Scaffold** – *"Build this assignment (attached PDF): full-stack real-time financial dashboard with CoinGecko, RBAC (viewer/trader/admin), role switcher, Chart.js chart, admin audit log, docker-compose or one-command start, tests, AI_PROMPTS.md."*
   → Monorepo (npm workspaces), Express API, React/Vite SPA, `npm run start:all`.
2. **Security model** – *"Enforce permissions in middleware for every route, deny by default, return 401 vs 403 correctly. Don't trust role claims from the client."*
   → `authenticate` mounted on the whole router, `authorize(permission)` per route, role re-read server-side, HS256 pinned.
3. **Resilience** – *"Handle CoinGecko free-tier rate limits: cache, exponential retry, mock fallback; tell the user which one is serving the data."*
   → `marketService.js` (TTL cache, coalescing, backoff + jitter, Retry-After, cooldown, stale, mock) and the `meta.source` badge.
4. **Tests** – *"Table-driven test for every route × role, plus token attacks (alg none, expired, forged secret, lying role claim) and fake-upstream tests for the retry logic."*
   → 96 backend tests + 7 frontend tests.
5. **Self-review** – *"Review your own code for ways a low-privilege user can still cause harm and write a failing test first."*
   → Findings below.

## Where the AI's output was wrong / unsafe, and how it was caught

### 1. Audit log could be flushed by a Viewer (security flaw, found in review, fixed)
The first version stored every audit event in one 500-entry ring buffer, including the `access.denied` entries created on each 403. A Viewer could call a forbidden endpoint 500+ times and push every real Trader/Admin action out of the log, i.e. erase evidence.
- **Caught by**: self-review prompt (#5). Wrote a failing test first (600 forbidden calls, then assert `watchlist.add` still exists) – it failed.
- **Fix**: two buffers in `store.js` (actions: 500, denied/failed: 200) merged by id on read. Test now passes.

### 2. Race condition in `POST /watchlist` (bug, fixed)
The handler checked `watchlist.has(id)`, then `await`ed a CoinGecko lookup, then inserted. Concurrent requests for the same asset all passed the check and produced duplicate inserts and duplicate audit entries.
- **Caught by**: same review. My first concurrency test *passed by accident* because the mock answered too fast to interleave requests, so I made the upstream artificially slow (50 ms) which made the test fail reliably.
- **Fix**: re-check `has(id)` after the `await` (single-threaded JS makes check+insert atomic with no await between them). Expected result `[201, 409, 409, 409, 409]`.

### 3. Flawed first draft of the RBAC test matrix (test bug, fixed)
The initial matrix reused one app across roles and special-cased expected statuses (e.g. "admin gets 409 because trader already added it"). It was order-dependent and hid intent.
- **Caught by**: reading the generated test; the special cases (`if (!seeded && method === 'POST' …)`) were a smell.
- **Fix**: rewritten so every (route, role) cell runs against a fresh app with state seeded directly in the store.

## Second review pass: hardening & operability

Prompt: *"Review best practices: env files, configuration, Docker, lint, CI. Verify that what the logs say matches reality."*

### 4. Misleading startup logs and a port that Windows refuses (operability bug, fixed)
The container logged `listening on http://localhost:4000` while Docker published it on 8080, so the printed URL was wrong for the user. Separately, port 4000 fell inside a TCP range Windows reserves for Hyper-V/WinNAT, so both Docker and plain `npm run start:all` failed with `EACCES`.
- **Caught by**: a user report plus checking `netsh interface ipv4 show excludedportrange`. My own first replacement choice (4100) was *also* inside a reserved range, which proved the problem was the fixed-port assumption, not one unlucky number.
- **Fix**: central validated `config.js`, `PUBLIC_PORT` for honest URLs, default dev port outside the reserved ranges, a readable error (instead of a stack trace) on `EACCES/EADDRINUSE`, and tests for config parsing.

### 5. Lint rules found real problems in generated React code (fixed)
ESLint with the React hooks rules flagged: `Date.now()` called during render in `useNow`, a `useEffect` that copied props into state (`ThresholdPanel`, replaced by derived state), `useMemo` dependencies that changed every render (`watchItems`), and a stale-closure dependency in the chart options.
