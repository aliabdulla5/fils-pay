# Submission folder

Prepared against `handover/FilsPay_Submission_Guidelines.pdf`. Deadline: Friday 11 pm.

## What is here

| File | Guideline item | State |
|---|---|---|
| `CaramelPopcorn_FilsPay_Submission.pdf` (+ `.html` source) | 1. Submission document | Complete except the yellow `[…]` blocks listed below. |
| `CaramelPopcorn_FilsPay_Slides.pdf` (+ `.html` source) | 2. Slide deck | Complete: 8 slides plus appendix. |
| `evidence/` | Appendix material | Test logs, the review patch, verification scripts, load-test driver/results/integrity check, before/after screenshots. |
| https://github.com/aliabdulla5/fils-pay | 3. Repository link | Public fork, pushed. |
| http://168.144.214.150 | 4. Live deployment | Up (health and readiness return 200). Server-side steps below are still open. |

The full findings list is `docs/BUG_INVENTORY.md` (items 1–94).

## Still open: needs a person or server access

1. **Live api is not in production mode.** At commit `4e85bda` the live login response still contains `devOtpCode`, which current code only returns outside production. Combined with the demo passwords published in `db/seed/generate.ts`, anyone can sign in to the live admin console. On the server:
   - set in `ops/.env`: `NODE_ENV=production`, `SETTLEMENT_INTERNAL_TOKEN`, `ACQUIRER_CALLBACK_SIGNING_SECRET`, `WEBHOOK_SECRET_ENCRYPTION_KEY` (`openssl rand -base64 32`), the `OTP_SMTP_*` / `OTP_FROM_EMAIL` settings, and `COOKIE_SECURE=false` while the site is plain HTTP
   - change the seeded admin and merchant passwords to values that are not in the repo, and give the judges theirs privately
   - then confirm a login sends an email and the response has no `devOtpCode`
2. **Load shedding on the live proxy.** The live server answers as the host's nginx (1.24, Ubuntu), not the compose `edge` container. Either run the compose `edge` service, or copy the `location /v1/` block and `limit_conn_zone` from `ops/api-proxy.inc` / `ops/nginx.conf` into the host nginx config.
3. **SMTP delivery** is verified only for the failure path (503, no code leaked, session revoked). Real delivery needs the provider's credentials on the server; send one test login after setting them.
4. **Section 3 numbers** were measured on a laptop. Re-run the load test against the live server when you are ready (it creates test payments in the live database).
5. **Section 5:** Ali Aldoseri's design screenshots.
6. **Cover page:** the last commit ID at the deadline.

## Exact commands on the server

```
cd fils-pay && git pull
docker compose -f ops/docker-compose.yml run --rm migrate          # applies 0080 (ledger indexes)
# Ports 80/8080 are held by the host nginx today. Either stop it and use the edge container:
sudo systemctl stop nginx && docker compose -f ops/docker-compose.yml up -d --build
# ...or keep the host nginx (with the ops/api-proxy.inc settings) and start only the services:
docker compose -f ops/docker-compose.yml up -d --build api settlement reporting
curl -s http://localhost/readyz                                      # {"status":"ready"}
curl -s -X POST -H 'content-type: application/json' http://localhost/v1/admin/auth/login \
  -d '{"email":"<admin email>","password":"<new password>"}'        # must NOT contain devOtpCode
```

## Verification (local, fresh throwaway database)

`VERIFY_PG_URL=postgres://<user>:<pass>@<disposable-host>/postgres scripts/dev/verify.sh`. Last run at `4e85bda`:
migrations 0001–0080 ok, typecheck ok. Failures, all known:
- 7 API tests (locked tests that assert the old bugs)
- 4 reporting tests (shared-database contamination; 11/11 on their own database)
- 1 scripts test (UTC month)
- 2 Go tests (`refresh_test.go`, pre-ADR-0008)

money 40/40, events 4/4, web 8/8, every other Go package ok.

## Regenerating the PDFs after editing the HTML

```
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=submission/CaramelPopcorn_FilsPay_Submission.pdf submission/CaramelPopcorn_FilsPay_Submission.html
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=submission/CaramelPopcorn_FilsPay_Slides.pdf submission/CaramelPopcorn_FilsPay_Slides.html
```
