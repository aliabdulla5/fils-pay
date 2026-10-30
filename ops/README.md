# ops/

Local development stack for FilsPay: Postgres plus the three services that
talk to it directly (apps/api, apps/settlement, apps/reporting). The hosted
demo instance uses the same compose file with a different `.env`.

## Quick start

```
docker compose -f ops/docker-compose.yml up -d postgres
docker compose -f ops/docker-compose.yml run --rm migrate
docker compose -f ops/docker-compose.yml --profile seed run --rm seed   # laptop only — wipes the database
docker compose -f ops/docker-compose.yml up -d --build   # edge, api, settlement, reporting
```

The `edge` service (nginx, `ops/Dockerfile.edge`) is the only public entry point. It serves the web app (checkout and merchant dashboard) on :80 and the admin console on :8080, and proxies `/v1` to the api on both. It also sheds load: at most 48 api requests are in flight, and the rest get a JSON 503 with `Retry-After`. The api and Postgres ports are bound to 127.0.0.1. Every service restarts on failure, and the api is limited to 0.5 vCPU / 512 MB.

For a laptop, copy `ops/.env.docker.example` to `ops/.env` and keep
`NODE_ENV=development`. Without it the api starts in production mode and
refuses to boot until its secrets are set — which is what the hosted box
needs. The `seed` job sits behind the `seed` profile so `docker compose up`
never runs it: it truncates the ledger, merchants and admin users.

For development, apps/web and apps/admin also run as plain Vite dev servers (`npm run dev` inside each package) that proxy `/v1` to apps/api.

## OTP email

Merchant and admin OTPs use the same SMTP relay. Set `OTP_SMTP_HOST`,
`OTP_FROM_EMAIL`, and the provider's SMTP credentials in `ops/.env`; use
`OTP_SMTP_PORT=465` with `OTP_SMTP_SECURE=true` for implicit TLS, or the
provider's STARTTLS port (commonly 587) with `OTP_SMTP_SECURE=false`.
`OTP_SMTP_USER` and `OTP_SMTP_PASSWORD` must either both be set or both be
blank for an unauthenticated internal relay. `OTP_FROM_NAME` is optional.

In production, missing or failed email delivery returns `otp_delivery_failed`
and does not create a usable pending login session. In development, when SMTP
is not configured, the OTP is logged for local use and may be returned as
`devOtpCode`; production never returns the code in the response.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | the stack |
| `.env.docker` | shared service settings, loaded by compose for every service |
| `Dockerfile.node` | image for api, reporting, migrate and seed (`node:20`, full install) |
| `Dockerfile.go` | multi-stage build of `apps/settlement` |

> **AM (July):** the two Dockerfiles aren't in the repo for me. built my own
>
> **MK:** they were in the initial ops commit. check you're on main

## Database

Every service, plus the one-off `migrate`/`seed` jobs, connects with the
same `filspay` role and the same `DATABASE_URL`
(`postgres://filspay:filspay_dev_password@postgres:5432/filspay?sslmode=disable`).
One role keeps local setup to a single password instead of hand-rolling
per-service grants for a stack this size. `sslmode=disable` is safe here:
Postgres and every service run on the same Docker Compose bridge network,
which never carries traffic outside the host, so there's no untrusted hop
for a connection to cross.

The settlement worker can be given a second connection string,
`PGCONN_SETTLEMENT`, for its batch-close pool. It only takes effect when
`DATABASE_URL` is unset.

To reset the database to a clean, freshly-seeded state at any point, re-run
the `seed` job above — `db/seed/index.ts` truncates and regenerates its
fixture tables on every invocation; it doesn't need the volume removed
first.

## Required settings per service

| Service | Needs | Where it comes from in compose |
|---|---|---|
| api | `DATABASE_URL`, `SETTLEMENT_INTERNAL_URL` | `environment:` |
| api | `NODE_ENV` | `ops/.env`; defaults to `production` |
| api | `WEBHOOK_SECRET_ENCRYPTION_KEY`, `ACQUIRER_CALLBACK_SIGNING_SECRET`, `SETTLEMENT_INTERNAL_TOKEN` | `ops/.env`; required in production |
| api | `OTP_SMTP_HOST`, `OTP_FROM_EMAIL`, optionally `OTP_SMTP_USER` / `OTP_SMTP_PASSWORD` | `ops/.env`; required for production OTP delivery |
| settlement | `DATABASE_URL` | `environment:` |
| settlement | `SETTLEMENT_INTERNAL_TOKEN` | defaults to `dev-token` |
| reporting | `DATABASE_URL` | `environment:`; runs `worker` by default |

> **MK:** the api won't boot without WEBHOOK_SECRET_ENCRYPTION_KEY in any environment. set it on the hosted box.

## Resource sizing

The hosted demo box is 0.5 vCPU / 2 GB RAM / 2 GB disk; the API container is
limited to 512 MB. Postgres defaults are fine at this size. The settlement
image is built on the box with `go build` from `Dockerfile.go`.

> **AM:** first build on the box filled the disk (go build cache). cleared it and it went through on the second try
