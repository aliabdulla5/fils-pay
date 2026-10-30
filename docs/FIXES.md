# FilsPay — Implemented Fixes

## 1. Overview

This document records the bug fixes, functional corrections and reliability improvements present in the FilsPay repository as of **2026-10-30** (branch `redesign/ui-ux`, HEAD `b0ac1f0`). Visual redesigns and new features are excluded (§5).

### How entries were verified

| Label | Meaning |
|---|---|
| **Confirmed (code)** | The corrected behaviour was found in the current source by inspection on 2026-10-30. The file and line are cited. |
| **Confirmed (test)** | Additionally exercised by a build, automated test or browser run on 2026-10-30. |
| **Reported** | Described as fixed in [`BUG_INVENTORY.md`](BUG_INVENTORY.md), but not independently verified for this document. |

### Where the fixes came from

| Source | Commits |
|---|---|
| Earlier review rounds 1–3 (inventory items 1–74), landed with the Docker work | `a4be087` (87 files) |
| Review round 4 (inventory items 75–92) | `ba163fe` (47 files) |
| Docker and dev-configuration fixes | `a31a1d5`, `185aac3` |
| Functional fixes made during the UI/UX work | `8b3d466`, `b0ed682`, `05f9c55` |

**Not counted as fixes, after checking their diffs:**

| Commit | Message | Why not counted |
|---|---|---|
| `a5bffea` | "fix flaky test…" | Only adds `CHANGELOG.md` |
| `6f462e1` | "fix: mark import amounts as intentional" | Labels the 10× CSV bug as intended; it doesn't fix it |
| `bf66bf2` | "fix: callbacks are deduplicated now" | No code change; its own message says "They are not" |
| `3d9b223`, `7805693` | security / cleanup | Empty commits |

Some commit messages also contain encoded, non-engineering text. It was not used as evidence.

> **Important:** `ba163fe` also **re-introduced** five defects that earlier rounds had fixed (inventory #23, #46, #49, #58, #62). Those are listed under **Unresolved Issues**, not here.

---

## 2. Implemented Fixes

### Authentication and access control

### Fix 01 — OTP codes bound to the intended user

**What didn't work:**
A one-time code could be associated with the wrong merchant user, blocking the real user or authenticating the wrong person.

**What was done:**
OTP challenges are created and verified against the specific merchant user who signed in (inventory #4).

**Affected area:** Authentication / Backend

**Verification:** Confirmed (code): [`apps/api/src/auth/otp.ts:48`](../apps/api/src/auth/otp.ts) stores `merchant_user_id` on every challenge.

### Fix 02 — OTP guess limit could be bypassed

**What didn't work:**
Two guesses arriving together could both pass the attempt check, and requesting a new code reset the counter, so an attacker got extra guesses.

**What was done:**
One attempt is now spent atomically before the code is compared, and a resent code inherits the previous attempt count (inventory #5, #6, #61).

**Affected area:** Authentication / Backend

**Verification:** Confirmed (code): [`apps/api/src/routes/auth.ts:160-171`](../apps/api/src/routes/auth.ts) (conditional `UPDATE … attempt_count < max_attempts`, `too_many_attempts`) and `:215-253` (resend keeps `attempt_count`).

### Fix 03 — Merchants logged out 10 minutes after signing in

**What didn't work:**
After a successful OTP, the session was promoted to 12 hours, but the browser cookie kept the 10-minute pending lifetime.

**What was done:**
The cookie is re-issued with the full session lifetime on OTP verification (inventory #82).

**Affected area:** Authentication / API

**Verification:** Confirmed (code): `routes/auth.ts:183` (`promoteSession(…, sessionTtlHours)`). The 12-hour lifetime itself wasn't exercised; the browser runs were shorter than the old 10-minute window.

### Fix 04 — Admin impersonation was too powerful

**What didn't work:**
- An admin "viewing as merchant" could inherit more than read-only rights, including capturing and voiding payments.
- A disabled admin's existing grant kept working.

**What was done:**
- Grants always map to the merchant `support` role.
- The grant lookup requires the admin to still be active.
- Merchant write routes reject impersonated requests (inventory #12, #13, #14, #15).

**Affected area:** Authentication / Backend

**Verification:** Confirmed (code):
- [`admin/impersonation.ts`](../apps/api/src/admin/impersonation.ts): `au.status = 'active'` in the lookup; `merchantRole` is always `support`.
- `requireMerchantWriterActor` in [`auth/requireMerchantAuth.ts:129`](../apps/api/src/auth/requireMerchantAuth.ts).
- `routes/refunds.ts:53`.

Confirmed (test): the impersonation cycle passed in the admin browser suite (2026-10-30).

### Fix 05 — Any merchant user could void a transaction

**What didn't work:**
A user without owner authority could void an authorization.

**What was done:**
The void route requires the `owner` role (inventory #54).

**Affected area:** Authentication / API

**Verification:** Confirmed (code): [`routes/transactions.ts:133`](../apps/api/src/routes/transactions.ts). See Unresolved U16 for the remaining finance-role mismatch in the UI.

### Fix 06 — Bulk KYC approval skipped eligibility and audit

**What didn't work:**
Bulk approval could approve rejected or ineligible merchants, and didn't write the required review record.

**What was done:**
Only `under_review` merchants are approved, and each approval writes a `merchant_kyc_reviews` row (inventory #18, #19).

**Affected area:** Backend

**Verification:** Confirmed (code): [`admin/bulkKyc.ts`](../apps/api/src/admin/bulkKyc.ts).

### Fix 07 — Unauthenticated export-summary endpoint returned 500

**What didn't work:**
`GET /v1/reporting/export-summary` had no authentication, so every call failed with a server error.

**What was done:**
`requireMerchantAuth` was added: unauthenticated requests now get 401 and signed-in merchants get 200 (inventory #75).

**Affected area:** API / Authentication

**Verification:** Confirmed (code): [`routes/reporting.ts:81`](../apps/api/src/routes/reporting.ts).

### Fix 08 — Merchants could read another merchant's report

**What didn't work:**
The report filter accepted any merchant that was a split child of *some* parent, so a merchant could read a marketplace sub-merchant's transactions that didn't belong to them.

**What was done:**
The child merchant must belong to the caller (inventory #76).

**Affected area:** API / Authentication

**Verification:** Confirmed (code): [`reporting/scope.ts:16`](../apps/api/src/reporting/scope.ts) (`parent_merchant_id = $1`).

### Fix 09 — API key rotation broke integrations immediately

**What didn't work:**
Rotating a key cut off clients still using the old key, with no transition period.

**What was done:**
The previous key stays valid for a grace period through scheduled revocation (inventory #60).

**Affected area:** API / Database

**Verification:** Confirmed (code): migration [`0056_api_keys_revoke_after.sql`](../db/migrations/0056_api_keys_revoke_after.sql).

### Acquirer callbacks and webhooks

### Fix 10 — Forged or replayed acquirer callbacks accepted

**What didn't work:**
- Callbacks without a signature were processed.
- Old callbacks could be replayed.
- Signature comparison leaked timing information.

**What was done:**
A signature is required, timestamps older than 300 seconds are rejected, and comparison is constant-time (inventory #7, #8, #9, #56).

**Affected area:** API / Security

**Verification:** Confirmed (code): [`webhooks/inboundVerify.ts:84`](../apps/api/src/webhooks/inboundVerify.ts) (`stale_timestamp`), `timingSafeEqualHex`, and `routes/acquirerCallbacks.ts:79` (`toleranceSeconds: 300`).

### Fix 11 — Correctly signed callbacks rejected

**What didn't work:**
The signature was checked over a re-serialised body instead of the bytes received, so valid callbacks with different whitespace or number formatting failed with 401.

**What was done:**
The route keeps the raw body and verifies it. Tampered bodies still fail, and malformed JSON returns 400 (inventory #89).

**Affected area:** API

**Verification:** Confirmed (code): [`routes/acquirerCallbacks.ts:24`](../apps/api/src/routes/acquirerCallbacks.ts) (`rawBodies`).

### Fix 12 — Outgoing webhook signatures didn't match the delivered body

**What didn't work:**
Payloads were serialised once for signing and again for sending, so receivers could fail signature verification.

**What was done:**
The dispatcher signs and sends the exact same bytes (inventory #55, #57).

**Affected area:** Backend / Integration

**Verification:** Confirmed (code): [`webhooks/dispatcher.ts:168`](../apps/api/src/webhooks/dispatcher.ts).

### Payments and checkout

### Fix 13 — One payment link charged two cards

**What didn't work:**
A slow pay attempt let a second buyer re-claim the same link, so both cards were charged (incident 2026-05-14). Holding locks also tied up database connections, stalling the whole API from a public endpoint.

**What was done:**
- Each pay attempt holds a per-token advisory lock for its whole duration.
- The attempt runs on that same connection, so it no longer pins extra pool connections (inventory #21).

**Affected area:** Checkout / Backend

**Verification:** Confirmed (code): [`paymentLinks/pay.ts:67-88`](../apps/api/src/paymentLinks/pay.ts). Confirmed (test): checkout browser suite (27/27) on 2026-10-30, including a real successful payment and "already paid" on reload.

### Fix 14 — Expired payment links could be paid

**What didn't work:**
The pay endpoint judged expiry using a client-supplied timestamp, so anyone could pay an expired link by sending an old time (FP-187).

**What was done:**
Expiry is decided by the server clock only.

**Affected area:** Checkout / API

**Verification:** Confirmed (code): `pay.ts:109-112` (`const expiryCheckTime = new Date()`).

### Fix 15 — Negotiated discount could be credited twice

**What didn't work:**
Replaying a capture whose discount rounded to zero re-credited the latest capture's discount. In a reproduction, a merchant was credited 2.500 BD twice.

**What was done:**
Discount adjustments are matched to the specific captures that are owed one, oldest first (inventory #88).

**Affected area:** Backend

**Verification:** Confirmed (code): [`payments/discountAdjustment.ts:61-83`](../apps/api/src/payments/discountAdjustment.ts). The fee formula in this file is still regressed; see U02.

### Fix 16 — Promotional discount amounts mis-scaled

**What didn't work:**
Discount amounts were converted with the wrong scale, producing the wrong discounted figure.

**What was done:**
Discounts are parsed as BHD with `parseBhdToFils` (inventory #50).

**Affected area:** Backend

**Verification:** Confirmed (code): `discountAdjustment.ts:3,9-22`.

### Fix 17 — Fees used today's rate instead of the rate in effect

**What didn't work:**
A capture could be charged at a rate that didn't apply on its date.

**What was done:**
The fee schedule is resolved by `effective_from` on the transaction date (inventory #63).

**Affected area:** Backend

**Verification:** Confirmed (code): [`fees/feeSchedule.ts:30`](../apps/api/src/fees/feeSchedule.ts).

### Refunds

### Fix 18 — Partial refunds could exceed the captured amount

**What didn't work:**
Two simultaneous partial refunds each saw the full remaining amount, and later refunds ignored earlier ones, so refunds could total more than the capture.

**What was done:**
The transaction row is locked and the remaining refundable amount is checked inside the same database transaction (inventory #31, #32).

**Affected area:** Backend

**Verification:** Confirmed (code): [`payments/processRefund.ts:84`](../apps/api/src/payments/processRefund.ts) (`FOR UPDATE`), [`payments/refundValidation.ts`](../apps/api/src/payments/refundValidation.ts) (`refund_exceeds_refundable`). Confirmed (test): the refund drawer preview and cap were exercised in the dashboard browser suite (no refund submitted).

### Fix 19 — Refund fee reversal could exceed the original fee

**What didn't work:**
Several partial refunds could reverse more fee than was charged, and discounted payments used the undiscounted basis.

**What was done:**
Cumulative reversal is capped and pro-rated (inventory #33, #34).

**Affected area:** Backend

**Verification:**
- Confirmed (code): `calculateRefundFee` in [`packages/money/src/fils.ts:260`](../packages/money/src/fils.ts).
- **Reported** for the discounted-basis part (#34).

### Fix 20 — Refunds without a reason failed or were incomplete

**What didn't work:**
Omitting the reason produced an incomplete record or a validation failure.

**What was done:**
A default reason is applied (inventory #35).

**Affected area:** Database

**Verification:** Confirmed (code): migration [`0070_refund_reason_default.sql`](../db/migrations/0070_refund_reason_default.sql). The dashboard still never sends a reason; see U18.

### Fix 21 — Refund endpoint unavailable to merchants

**What didn't work:**
The only refund endpoint was a 501 stub, although refund processing existed.

**What was done:**
A merchant-scoped refund route was added. The legacy `/v1/refunds` stub is kept, as API instructions require (inventory #30, partial).

**Affected area:** API

**Verification:** Confirmed (code): `merchantRefundRoutes` in [`routes/refunds.ts`](../apps/api/src/routes/refunds.ts).

### Settlement, ledger and reconciliation

### Fix 22 — Settlement ignored refunds

**What didn't work:**
- Batch net payouts still included refunded money.
- Refunds crossing settlement windows could be lost from the carry-forward.

**What was done:**
Refunds are netted into each batch (inventory #36, #37).

**Affected area:** Backend (settlement)

**Verification:**
- Confirmed (code): [`apps/settlement/internal/settlement/batch.go:237`](../apps/settlement/internal/settlement/batch.go) ("Step 8b … net this merchant's refunds").
- **Reported** for the carry-forward part (#37).

### Fix 23 — Reconciliation miscounted payouts and pending refunds

**What didn't work:**
Payouts could be counted twice, and pending refunds were missing from the reconciliation.

**What was done:**
Payouts are deduplicated and pending refunds are subtracted (inventory #40, #41).

**Affected area:** Backend

**Verification:**
- Confirmed (code) for #41: [`settlement/query.ts:354`](../apps/api/src/settlement/query.ts).
- **Reported** for #40.
- Confirmed (test): the reconciliation report rendered correctly in the browser suites.

### Fix 24 — Scheme export amounts and lost fils

**What didn't work:**
The exported amount didn't follow the required two-decimal truncation, and the truncated fils disappeared from the books.

**What was done:**
The file amount derives from truncated integer fils, and the residue is journaled to a rounding account (inventory #42, #43).

**Affected area:** Backend (settlement)

**Verification:** Confirmed (code): `TruncateToSchemeAmount` in [`scheme_export.go:17`](../apps/settlement/internal/settlement/scheme_export.go); `batch.go:352` (residue). See U27 for a latent rounding issue in the stored column.

### Fix 25 — Split payouts lost or misallocated a fil

**What didn't work:**
Rounded shares didn't add back up to the total.

**What was done:**
Largest-remainder allocation (inventory #44).

**Affected area:** Backend

**Verification:** Confirmed (code): `allocateRemainder` in [`packages/money/src/fils.ts:161`](../packages/money/src/fils.ts).

### Fix 26 — Paid batches altered by fee changes

**What didn't work:**
An MDR recalculation could change figures of a batch that had already been paid.

**What was done:**
Paid batches are left as paid; differences go to the next period (inventory #45).

**Affected area:** Backend (settlement)

**Verification:** Confirmed (code): [`recalculate_mdr.go:21`](../apps/settlement/internal/settlement/recalculate_mdr.go).

### Fix 27 — Balance rebuild and settlement could overwrite each other

**What didn't work:**
Concurrent cache updates left a stale cached balance.

**What was done:**
Both paths lock the cache rows before updating (inventory #53).

**Affected area:** Backend

**Verification:** Confirmed (code): [`ledger/rebuild.go:111`](../apps/settlement/internal/ledger/rebuild.go).

### Fix 28 — "Rebuild cached balances" overwrote balances with gross exports

**What didn't work:**
The rebuild read a view that summed gross scheme exports, ignoring fees, payouts, refunds and adjustments. One click overwrote every merchant's cached balance (FP-203).

**What was done:**
The view now computes credits minus debits on `merchant_payable` from the ledger, with a supporting index (inventory #51, #52; ADR-0008).

**Affected area:** Database

**Verification:** Confirmed (code): migration [`0078_merchant_payable_position_from_ledger.sql`](../db/migrations/0078_merchant_payable_position_from_ledger.sql).

### Fix 29 — Payout record written per webhook delivery instead of per payout

**What didn't work:**
The disbursement record was created by the webhook dispatcher: one per endpoint and replay, and none for merchants without endpoints.

**What was done:**
It is written once, inside the payout transaction (inventory #77).

**Affected area:** Backend (settlement) / Database

**Verification:** Confirmed (code): `batch.go:457` (`INSERT INTO settlement_payout_disbursements`).

### Fix 30 — Batch could be closed for a day still in progress

**What didn't work:**
Running a batch for today or a future date froze the batch, stranding later same-day captures unsettled.

**What was done:**
Closing is refused until the business day is complete (`business_day_not_complete`) (inventory #78).

**Affected area:** Backend (settlement) / API

**Verification:** Confirmed (code): `ErrBusinessDayNotComplete` in [`batch.go:25`](../apps/settlement/internal/settlement/batch.go).

### Fix 31 — Admin batch date defaulted to two days ago

**What didn't work:**
Between 00:00 and 03:00 Bahrain time, the admin console's default "yesterday" was a UTC date two days back.

**What was done:**
The default is the last completed Asia/Bahrain business day (inventory #92).

**Affected area:** Frontend (admin)

**Verification:** Confirmed (code): [`apps/admin/src/pages/settlement/SettlementPage.tsx:19`](../apps/admin/src/pages/settlement/SettlementPage.tsx).

### Fix 32 — Marketplace parents missing from payout monitoring

**What didn't work:**
Split payouts didn't update the lifetime payout estimate.

**What was done:**
`PayoutSplitBatch` updates it like `PayoutBatch` does (inventory #91).

**Affected area:** Backend (settlement)

**Verification:** Confirmed (code): [`splits/allocate.go:169`](../apps/settlement/internal/splits/allocate.go).

### Fix 33 — Platform volume counter wrapped negative

**What didn't work:**
The 32-bit counter overflowed to a negative value, switching the volume-tier fee bonus off.

**What was done:**
It now clamps at its maximum instead of wrapping (inventory #73, partial).

**Affected area:** Backend (settlement)

**Verification:** Confirmed (code): [`platform_volume.go:36`](../apps/settlement/internal/settlement/platform_volume.go) (`math.MaxInt32`). The column width remains open; see U13.

### Admin finance operations

### Fix 34 — Same adjustment file could be applied twice

**What didn't work:**
Re-uploading a CSV posted the same balance changes again. On 2026-09-04 a 31-row file was posted twice.

**What was done:**
Imports are fingerprinted by content (`content_sha256`, unique), and duplicates are refused with `duplicate_import` (inventory #27, #28, #59).

**Affected area:** Backend / Database

**Verification:** Confirmed (code): migration [`0079_adjustment_imports_content_hash.sql`](../db/migrations/0079_adjustment_imports_content_hash.sql), [`admin/adjustmentImport.ts:86`](../apps/api/src/admin/adjustmentImport.ts).

### Fix 35 — Credits could be dated in the future

**What didn't work:**
A future effective date placed the credit in a reconciliation period that hadn't happened yet.

**What was done:**
Dates after today's Bahrain business date are rejected with 400 (inventory #90).

**Affected area:** API / Backend

**Verification:** Confirmed (code): [`admin/creditRequestValidation.ts`](../apps/api/src/admin/creditRequestValidation.ts).

### Fix 36 — Admin analytics rebuild lost refunds and double-counted

**What didn't work:**
"Rebuild analytics" zeroed refund totals and double-counted captures the reporting worker hadn't consumed yet.

**What was done:**
It rebuilds from the outbox up to the consumer's watermark, under lock (inventory #79).

**Affected area:** Backend

**Verification:** Confirmed (code): [`admin/reportingRebuild.ts`](../apps/api/src/admin/reportingRebuild.ts).

### Merchant data, validation and API errors

### Fix 37 — Merchant pages crashed on negative amounts

**What didn't work:**
Refund timeline events and reconciliation gaps are negative, and the formatter threw on them. Every refunded transaction's detail page and the reconciliation page failed to render.

**What was done:**
The dashboard formatter allows negative amounts (inventory #81).

**Affected area:** Frontend

**Verification:** Confirmed (code): [`apps/web/src/format.ts:15`](../apps/web/src/format.ts). Confirmed (test): `dashboard.test.ts` (8/8) and the reconciliation page in the browser suites.

### Fix 38 — Bad business-profile input caused server errors

**What didn't work:**
- An unknown field in a profile update produced `SET undefined = …`.
- An unknown business type hit the database constraint.

Both returned 500.

**What was done:**
Only allow-listed columns are updated, and `businessType` is validated, returning 400 (inventory #83, #87).

**Affected area:** API

**Verification:** Confirmed (code): [`onboarding/businessProfile.ts:121`](../apps/api/src/onboarding/businessProfile.ts), [`routes/businessProfile.ts:17`](../apps/api/src/routes/businessProfile.ts).

### Fix 39 — Invalid date filters caused server errors

**What didn't work:**
`GET /v1/transactions` and `/export` passed invalid dates to Postgres and returned 500, although the API documents 400.

**What was done:**
Invalid `from` or `to` values return 400 (inventory #84).

**Affected area:** API

**Verification:** Confirmed (code): [`routes/transactions.ts:66`](../apps/api/src/routes/transactions.ts).

### Fix 40 — KYC downloads failed for Arabic filenames

**What didn't work:**
Non-Latin filenames, or names containing quotes, broke the download header and returned 500.

**What was done:**
An ASCII fallback plus the RFC 6266 `filename*` form (inventory #85).

**Affected area:** API

**Verification:** Confirmed (code): [`routes/kyc.ts:31`](../apps/api/src/routes/kyc.ts).

### Reporting, scripts and operations

### Fix 41 — Reports used UTC dates

**What didn't work:**
Transactions near midnight were reported under the wrong business date.

**What was done:**
Reporting uses Bahrain business dates (inventory #39).

**Affected area:** Backend (reporting)

**Verification:** Confirmed (code): [`apps/reporting/src/consumer/applyEvent.ts:2`](../apps/reporting/src/consumer/applyEvent.ts) (`toBahrainDateString`).

### Fix 42 — Nightly hold expiry could delete every hold

**What didn't work:**
On a night with no expired holds, an empty id list was dropped from the filter, and the script ran `DELETE FROM holds`, wiping live holds.

**What was done:**
An empty list matches nothing (`FALSE`), and the script runs in one locked transaction (inventory #80).

**Affected area:** Database / Other (scripts)

**Verification:**
- Confirmed (code): [`scripts/lib/sqlFilter.ts:13`](../scripts/lib/sqlFilter.ts).
- **Reported** for the transaction and locking part.

### Fix 43 — Compose startup could erase the database

**What didn't work:**
`docker compose up` re-ran the destructive seed, wiping merchants and ledger data (including on the hosted box).

**What was done:**
The seed is opt-in only, through a compose profile (inventory #11).

**Affected area:** Other (ops)

**Verification:** Confirmed (code): `profiles: ["seed"]` in [`ops/docker-compose.yml`](../ops/docker-compose.yml).

### Fix 44 — Production could start with development behaviour

**What didn't work:**
- With `NODE_ENV` unset, the hosted API exposed OTP codes, accepted unsigned callbacks, used the built-in webhook key and sent non-Secure cookies.
- Missing secrets weren't caught.

**What was done:**
`NODE_ENV` defaults to `production` in compose, and production refuses to boot without its secrets (inventory #10, #67).

**Affected area:** Other (ops) / Security

**Verification:** Confirmed (code): [`apps/api/src/config.ts:3-5`](../apps/api/src/config.ts), `ops/docker-compose.yml`.

### Fix 45 — Database exposed on all network interfaces

**What didn't work:**
Postgres was published on every interface with the committed dev password.

**What was done:**
Bound to `127.0.0.1` (inventory #86).

**Affected area:** Other (ops) / Security

**Verification:** Confirmed (code): `"127.0.0.1:5432:5432"` in `ops/docker-compose.yml`.

### Fix 46 — Unique constraint migration failed on existing duplicates

**What didn't work:**
Adding uniqueness to payout notifications failed on databases that already held duplicate rows.

**What was done:**
The migration cleans or retags duplicates before adding the constraint (inventory #22, #64).

**Affected area:** Database

**Verification:** Confirmed (code): [`0077_running_totals_bigint.sql:8`](../db/migrations/0077_running_totals_bigint.sql).

### Fix 47 — API Docker image failed to build

**What didn't work:**
The password-hashing dependency (argon2) has no prebuilt binary for the image, so `npm install` failed. The opt-in seed service also lacked the API's environment.

**What was done:**
Python and a C/C++ toolchain were added to the Node image, and the seed service got the same environment variables (commit `a31a1d5`).

**Affected area:** Other (build / ops)

**Verification:** Confirmed (code): `ops/Dockerfile.node` installs `python3 make g++`; `ops/docker-compose.yml` seed service environment. The stack built from these files was running on 2026-10-30, and every browser suite ran against it. The image wasn't rebuilt for this document.

### Fix 48 — Dashboards couldn't reach the API reliably

**What didn't work:**
Without a base URL, both frontends fell back to calling `http://localhost:3000` directly: a different origin from the dev server, which the session cookies and CORS don't handle.

**What was done:**
`VITE_API_BASE_URL=` and `VITE_ADMIN_API_BASE_URL=` (empty) make both apps call `/v1` on their own origin through the Vite proxy (commit `185aac3`).

**Affected area:** Frontend / Integration

**Verification:** Confirmed (test): sign-in and data loading in all 2026-10-30 browser suites (122 functional checks).

### Functional fixes made during the UI/UX work

These problems existed on `main` before the redesign. Problems introduced and corrected within the redesign branch itself are not listed.

### Fix 49 — Settlement batch list empty state misaligned

**What didn't work:**
The "no batches" row spanned 7 of the table's 8 columns.

**What was done:**
The empty row spans all 8 columns.

**Affected area:** Frontend (merchant dashboard)

**Verification:** Confirmed (code): [`SettlementBatchListPage.tsx`](../apps/web/src/pages/settlement/SettlementBatchListPage.tsx) (`colSpan={8}`), commit `8b3d466`. Confirmed (test): web build.

### Fix 50 — Checkout success page showed a raw timestamp

**What didn't work:**
After paying, customers saw `paidAt` as a raw ISO string (e.g. `2026-10-30T17:28:27.620Z`).

**What was done:**
The time is shown in the payer's locale, falling back to the raw value if it can't be parsed (commit `b0ed682`).

**Affected area:** Checkout

**Verification:** Confirmed (test): checkout suite check "paid-at shown as a readable date" passed (27/27).

### Fix 51 — Missing favicon

**What didn't work:**
Every page load in both apps requested `/favicon.ico` and got a 404 console error.

**What was done:**
An SVG favicon was added to both apps and linked from `index.html` (commit `05f9c55`).

**Affected area:** Frontend

**Verification:** Confirmed (test): the cross-app audit re-run on 2026-10-30 reported no 404s for assets.

### Fix 52 — Unknown URLs showed a developer error screen

**What didn't work:**
Any URL that matched no route displayed React Router's built-in "Unexpected Application Error / 404" screen and logged a console error.

**What was done:**
A catch-all route in each app shows a "Page not found" page with a link back. Existing routes are unchanged (commit `05f9c55`).

**Affected area:** Frontend / Navigation

**Verification:** Confirmed (test): the audit re-run reported no console errors on `/dashboard/does-not-exist` and admin `/does-not-exist`.

### Fix 53 — Dashboard browser tab labelled "Checkout"

**What didn't work:**
Every merchant-dashboard page carried the title "FilsPay Checkout" (flagged in a code comment).

**What was done:**
The web app's title is "FilsPay" (commit `05f9c55`).

**Affected area:** Frontend

**Verification:** Confirmed (code): [`apps/web/index.html`](../apps/web/index.html).

### Reported fixes (not independently verified)

These appear in [`BUG_INVENTORY.md`](BUG_INVENTORY.md) as fixed, but no specific marker was checked for this document:

| Inventory # | Reported fix |
|---|---|
| #20 | KYC multi-file upload no longer buffers every file in memory |
| #24, #25, #26 | March close script: journal legs, effective date and log appending corrected |
| #29, #68 | Seed fee values aligned with settlement |
| #38 | Reporting consumes refund events |
| #48 | Test-mode state recomputed from current inputs |
| #65, #66 | Settlement daemon and window timezone handling |
| #69 | Reporting worker no longer crashes on a missing rollup row |

---

## 3. Unresolved Issues

### Fixed earlier, but re-broken in the current code

These were reintroduced by `ba163fe`.

| # | Issue | Evidence |
|---|---|---|
| U01 | **Adjustment CSV import posts one tenth of every amount**: `4.750` posts 0.475 BD (inventory #49) | [`admin/adjustmentCsvParsing.ts:8`](../apps/api/src/admin/adjustmentCsvParsing.ts) uses a 2-decimal parser; executed 2026-10-30 |
| U02 | Discounted fee: the API ledger and Go settlement differ by up to 1 fil per capture (#62) | `discountAdjustment.ts:73` vs `discounted_fee.go:7-9` |
| U03 | Admin "current negotiated rate" shows the latest-entered schedule, not the one in effect (#46) | `fees/currentFeeScheduleDisplay.ts:43` |
| U04 | March close script uses a UTC month instead of the Bahrain month (#23) | `scripts/reconcile_march.ts:29-33` |
| U05 | Production webhook dispatcher contains a test-only `NODE_ENV` branch (#58) | `webhooks/dispatcher.ts:59` |
| U06 | `apps/reporting` `npm test` runs the destructive seed first | `apps/reporting/package.json:9` |

### Kept as-is by repository instruction

| # | Issue | Inventory |
|---|---|---|
| U07 | OTP, invite and payment-link tokens use `Math.random()` | #1, #2, #3 |
| U08 | Credit self-approval compares display names, not user ids | #16, #17 |
| U09 | Transaction CSV export loads the full result into memory | #47 |
| U10 | Legacy `POST /v1/refunds` still returns 501 | #71 |
| U11 | No `refund.succeeded` webhook (deferred to v1.9) | #72 |

### Open

| # | Issue |
|---|---|
| U12 | Outbox consumed by id, not commit order; a late-committing lower id can be skipped (#70) |
| U13 | Platform volume counter is a 32-bit `INTEGER`; clamped, but the true total is lost (#73) |
| U14 | Lifetime payout estimate stored as `REAL`, imprecise above 16,777.216 BD (#74) |
| U15 | Suspended or closed merchants can still take payments; there's no suspend control |
| U16 | Role mismatch: support can capture through the API; finance sees a Void button that returns 403 |
| U17 | Credit threshold ignores fee reversal; balance adjustments of any size need only one operator |
| U18 | The dashboard never sends a refund reason, so every refund is stored as `unspecified` |
| U19 | A non-integer `amountFils` on authorize or capture returns 500 instead of 400 |
| U20 | Refund hold (`refunds_enabled`) has no writer, and its migration contradicts itself on `NULL` |
| U21 | Webhooks: no event subscriptions, no private-address (SSRF) check, no duplicate-URL check |
| U22 | Payment-link reference is optional and not unique; no length or amount limits |
| U23 | Business profile fields are checked for presence only (email, phone and CR formats unchecked) |
| U24 | A stale `reserved` link past its expiry is reported publicly as `active` |
| U25 | The reconciliation "pending" figure uses a floating-point fee estimate (`fees/estimate.ts`) |
| U26 | Dead `notifySettlementRefundAdjustment` sends fils ÷ 10 in a field named `amountFils` |
| U27 | `scheme_export_lines.amount NUMERIC(10,2)` rounds on assignment (latent; current rows agree) |
| U28 | **Currency architecture (BHD frontend and API, fils backend) is not implemented**: 4 forms take fils input, and the API contract is fils |
| U29 | `CLAUDE.md` and migration comments contradict the code (cents vs fils, impersonation gate, token entropy) |
| U30 | Reported as plausible in the inventory: the reporting worker blocks on one bad event; `RecalculateMDR` ignores fee schedules; no login rate limit |
| U31 | Payment-link detail page finds only links among the 100 most recent (no single-link endpoint) |
| U32 | Tests: 7 stale API assertions and 1 stale script assertion conflict with fixed behaviour; Go DB tests skip silently without `DATABASE_URL` |

Details and evidence: [`audit/FILSPAY_BUSINESS_AUDIT.md`](audit/FILSPAY_BUSINESS_AUDIT.md) and [`audit/CURRENCY_HANDLING_AUDIT.md`](audit/CURRENCY_HANDLING_AUDIT.md).

---

## 4. Verification Summary

Runs performed on 2026-10-30 against the local Docker stack:

| Check | Result |
|---|---|
| `apps/web` typecheck and production build | Pass |
| `apps/admin` typecheck and production build | Pass |
| `apps/web` unit tests (`dashboard.test.ts`) | 8/8 pass |
| Root `npm test` | Package suites pass (4/4, 40/40, 8/8). The **API integration suite (29 files) fails without `DATABASE_URL`** pointing at a migrated database. It was not run against the dev database, because the reporting test script seeds destructively (U06). |
| Browser regression: merchant dashboard (owner, support) | 27/27 |
| Browser regression: admin console (support, finance, super_admin, including impersonation) | 68/68 |
| Browser regression: checkout (all 9 states) | 27/27 |
| Accessibility (axe-core, WCAG 2.1 AA, 23 routes) | 0 violations after fixes |
| Code inspection of inventory fixes | Fixes 01–46 each confirmed by a cited code marker; 10 inventory items reported only; 6 regressions confirmed (U01–U06) |

Additional evidence logs from the round-4 review are committed under `submission/evidence/`. They are **reported**, not re-run here.

---

## 5. Excluded Changes

The following are intentionally not listed as fixes:

- **Visual redesign:** the UI/UX redesign of the merchant dashboard, admin console and checkout (`8b3d466`, `4d3cf6e`, `b0ed682`), and the brand and styling consistency work in `05f9c55` (colour tokens, radii, shadows, typography).
- **New features and documentation:** the shared `packages/ui` design tokens, new screens such as the admin import file picker, and the audit documents.
- **Issues the redesign itself introduced and then corrected:** for example, header overlap, focus styles on date inputs, keyboard access to scrolling tables, and mobile overflow on new layouts.
- **Commits whose messages claim a fix but contain no corresponding code change** (listed in §1).
