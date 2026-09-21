# Revu backend

Independent local backend for the Revu Google Business Profile dashboard. It uses Fastify, Prisma/PostgreSQL, BullMQ/Redis, and provider adapters for Google Business Profile, Anthropic, and Meta WhatsApp.

The default configuration is fully offline: `AUTH_MODE=dev`, `PROVIDER_MODE=mock`, and `REPLY_PROVIDER_MODE=mock`. It does not call Google, Anthropic, or Meta and does not contain deployment configuration.

## Start locally

Prerequisites: Docker with Compose v2. From this repository:

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, applies the checked-in migration, seeds deterministic Hebrew demo data, then starts the API and worker with source watching.

- API: `http://localhost:3001`
- Swagger UI: `http://localhost:3001/docs`
- Liveness: `http://localhost:3001/health/live`
- Readiness: `http://localhost:3001/health/ready`
- Expected frontend origin: `http://localhost:5173`

Development requests authenticate as `admin@revu.local`. Use `x-dev-user-email: member@revu.local` to exercise the other seeded user. Mutations require the CSRF token returned by `GET /api/v1/session`; send it in `x-csrf-token` and retain the `revu_csrf` cookie.

```bash
curl -c /tmp/revu-cookies http://localhost:3001/api/v1/session
curl -b /tmp/revu-cookies http://localhost:3001/api/v1/bootstrap
```

Use the session response's `csrfToken` for POST, PUT, PATCH, and DELETE requests.

## Commands

```bash
npm run dev:api          # API with automatic restart
npm run dev:worker       # workers and scheduler registration
npm run db:deploy        # apply checked-in migrations
npm run db:seed          # repeatable deterministic seed
npm run db:reset         # destructive local DB reset + seed
npm run jobs:trigger     # manually queue sync and renewal scans
npm run reviews:add-negative-samples # create 1–3 star reviews and wait for Anthropic drafts
npm run typecheck
npm run lint
npm test
npm run build
```

For host-based development, copy `.env.example` to `.env` and change the database and Redis hosts from `postgres`/`redis` to `localhost`.

To exercise real Anthropic draft generation without Docker, start `npm run dev:worker` in one terminal and then run:

```bash
npm run reviews:add-negative-samples
```

The command requires `PROVIDER_MODE=mock`, `REPLY_PROVIDER_MODE=anthropic`, and `ANTHROPIC_API_KEY`. Restart the worker after changing `.env` and keep only one local worker running, since duplicate workers may consume jobs with stale configuration. The command creates fresh 1-, 2-, and 3-star reviews across the three seeded locations, waits up to 90 seconds for `QUEUED → PROCESSING → PENDING_APPROVAL`, and prints the drafts saved in PostgreSQL. Refresh the reviews page to see them; the sample rows remain until deleted through the UI.

## Architecture

- `src/api.ts` starts Fastify; `src/app.ts` owns middleware and route registration.
- `src/worker.ts` starts the `maintenance`, `review-ai`, `post-publish`, and `notifications` workers and registers stable BullMQ Job Schedulers.
- `src/jobs/handlers.ts` implements idempotent review synchronization, review processing/approval, notifications, and recurring post publication.
- `src/providers` contains interfaces plus mock and live implementations. The application selects them only through `createProviders`.
- `prisma/schema.prisma` is the source model; the SQL migration also adds database check constraints Prisma cannot express directly.
- Google access and refresh tokens are AES-256-GCM encrypted with a versioned key ring. Sessions and OAuth state are stored in Redis.

All business queries derive `agencyId` from the authenticated user. The API never accepts a tenant ID from a client. Google staff OIDC and Google Business authorization use separate grants and callbacks.

## API surface

Authentication and connections:

- `GET /auth/google/start`, `GET /auth/google/callback`
- `GET /api/v1/session`, `POST /api/v1/logout`
- `GET /api/v1/google-business/connect`, `GET /api/v1/google-business/callback`

Dashboard:

- `GET /api/v1/bootstrap`, `/overview/stats`, `/locations`, `/reviews`, `/posts`
- `PUT /api/v1/reviews/:id/draft`
- `POST /api/v1/reviews/:id/approve`
- `DELETE /api/v1/reviews/:id`
- `POST /api/v1/posts`, `PATCH /api/v1/posts/:id/status`
- `PATCH /api/v1/locations/:id/settings`

Review and post lists support `locationId`, `cursor`, and `limit`; reviews also support `status`, `rating`, and `q`. API errors use `{ "error": { "code", "message", "requestId" } }`.

## Live adapters (opt-in)

`PROVIDER_MODE` controls the Google Business and WhatsApp adapters. `REPLY_PROVIDER_MODE` independently controls reply generation, so local development can keep Google and WhatsApp mocked while calling Anthropic:

```dotenv
PROVIDER_MODE=mock
REPLY_PROVIDER_MODE=anthropic
ANTHROPIC_API_KEY=your-backend-only-key
```

Restart the worker after changing these values because all Anthropic requests run there. Generated drafts are saved to PostgreSQL before the API returns them to the frontend. The API key must never be placed in a frontend or `VITE_` environment variable.

Set `PROVIDER_MODE=live` only after configuring Google OAuth and Meta values from `.env.example`. When `REPLY_PROVIDER_MODE` is omitted, it defaults to `anthropic` for live integrations and `mock` otherwise, preserving the existing live behavior. Startup fails fast if credentials required by either selected mode are absent. `AUTH_MODE=google` independently enables staff OIDC. Development auth is refused when `NODE_ENV=production`.

Google Business uses the `business.manage` scope and refreshes access tokens through `google-auth-library`. Anthropic defaults to `claude-sonnet-4-6`, constructs a Hebrew-only prompt without the reviewer name, limits untrusted review input, and rejects empty output. Reviews below four stars are stored as drafts for explicit approval and are never automatically published. Meta sends the configured approved template and validates E.164 destinations.

The frontend consumes these DTOs through its HTTP service without coupling UI components to Prisma, BullMQ, or Anthropic.

## Reset and inspection

```bash
docker compose exec api npm run jobs:trigger
docker compose logs -f worker
docker compose down                 # preserve database and Redis volumes
docker compose down --volumes       # permanently remove local data
```

Mock Google actions are stored in `ProviderEvent`; mock WhatsApp sends are stored in `NotificationLog`. Set `MOCK_FAILURE_MODE=transient` or `permanent` to exercise retry handling.
