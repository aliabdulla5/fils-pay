# Bug and defect inventory

This inventory consolidates findings from the sibling `fils-pay-CaramelPopcorn` review (`REPORT.md`, `FIXES.en.md`, `FINDINGS.en.md`, and round-three notes) and defects identified while reviewing this checkout. Each entry states the failure in everyday terms and describes the change or reason it was left alone. Treat a status of “Fixed” as a description of the code change recorded by the review; use the file links and Git diff to inspect implementation details.

## Counting method

The sibling report's 25 case files are not 25 individual defects: composite cases are split below when they describe independent failure modes. Repeated descriptions of the same failure are counted once. That yields **74 distinct reported or confirmed defects** in this inventory. Item 47 is a reported performance concern that repository instructions explicitly designate as intentional; excluding that disputed item gives **73 actionable defects**. Test expectation and test-isolation problems are tracked separately and are not included in the product-defect count. Review rounds 4–5 (2026-10-30) add items 75–92 and corrects the status of items 23, 46, 49, 58, 62 and 73. Items 93–94 were consolidated from `docs/FIXES.md` on 2026-10-30. Current totals are at the end of this file.

“Fixed” means a source or migration change is present in this checkout. “Retained by instruction” means the issue was identified but left as-is because repository guidance explicitly prohibits the change. “Open” means the defect or operational follow-up remains. “Reported; intentionally retained” identifies a concern from the sibling report that conflicts with repository guidance.

## Inventory

The “Defect” column describes the bad behavior and its likely effect. The “Resolution” column explains what changed, or why the behavior remains. “Fixed” does not mean that every possible edge case has been proven absent; verification results and known test issues are listed below.

| # | Defect (what could go wrong) | Resolution (what changed or why it remains) |
|---:|---|---|
| 1 | OTP codes use a weak random source, so their values may be more predictable than a cryptographic generator's. | Retained by instruction: `Math.random()` is explicitly documented as intentional for OTPs. |
| 2 | Invite tokens use a weak random source, so a token could be guessed more easily than with a cryptographic generator. | Retained by instruction: the database enforces uniqueness and repository guidance explicitly permits this. |
| 3 | Payment-link slugs use a weak random source, so a slug could be guessable. | Retained by instruction: repository guidance explicitly permits this for non-security-critical slugs. |
| 4 | An OTP challenge could be associated with the wrong merchant user, preventing the intended user from logging in or authenticating the wrong recipient. | Fixed: challenge creation and verification bind the code to the intended merchant user and email. |
| 5 | Two OTP guesses arriving at the same time could both read the same old attempt count, letting a user exceed the configured limit. | Fixed: attempt updates are serialized so concurrent guesses cannot bypass the limit. |
| 6 | Requesting a replacement OTP could reset the failed-guess counter and give an attacker more guesses. | Fixed: resending a code no longer restores the failed-attempt allowance. |
| 7 | An incoming acquirer callback without a signature could be processed as if it were genuine. | Fixed: callback authentication now requires a valid signature. |
| 8 | A previously valid callback could be replayed much later. | Fixed: callback timestamps are checked for freshness before accepting the request. |
| 9 | Ordinary string comparison could leak information about how much of a callback signature matched. | Fixed: signature comparison uses a constant-time check. |
| 10 | A production API could accidentally start with development behavior or settings. | Fixed: production mode/configuration is enforced when the API starts. |
| 11 | Starting the compose stack could rerun a destructive seed and erase or replace local database data. | Fixed: normal compose startup no longer reruns the destructive seed service. |
| 12 | An impersonating admin could inherit permissions beyond the intended support role. | Fixed: the impersonated role is mapped to the restricted merchant-plane permissions. |
| 13 | An admin account that has been disabled could continue using an already-issued impersonation grant. | Fixed: the grant lookup checks that the associated administrator is still active. |
| 14 | An admin using impersonation could capture a payment while appearing to act as the merchant. | Fixed: merchant write routes reject requests made under an impersonation grant. |
| 15 | An admin using impersonation could void a transaction under the merchant's identity. | Fixed: transaction void/write routes reject impersonated requests. |
| 16 | A credit approver can approve their own request when identities are checked incorrectly. | Retained by instruction: the prescribed `displayName` audit comparison is explicitly intentional. |
| 17 | Different administrators sharing a display name can be incorrectly treated as the same approver. | Retained by instruction: same prescribed comparison; requires policy clarification before changing. |
| 18 | Bulk KYC approval could move a rejected or otherwise ineligible merchant to approved. | Fixed: the approval operation checks that the merchant is in the pending-review state. |
| 19 | A bulk approval could change a merchant's KYC state without recording the required reviewer/audit row. | Fixed: the operation requires and writes the review record as part of approval. |
| 20 | Uploading several KYC documents could hold every file in memory at once and exhaust API memory. | Fixed: upload handling is bounded/streamed instead of buffering the complete set. |
| 21 | A payment-link lock could be held in a way that ties up API database connections and stalls unrelated requests. | Fixed: lock and connection handling is narrowed so the critical section does not monopolize the pool. The whole pay attempt now runs on the connection that holds its advisory lock, instead of pinning a second pool connection (`paymentLinks/pay.ts`). The same lock fixes the double charge in item 93. |
| 22 | Adding payout-notification uniqueness could fail on databases that already contain duplicate rows. | Fixed: migration 0077 cleans/retags existing duplicates before adding the unique constraint. |
| 23 | The March close script uses the wrong month boundary. | Fixed in `HEAD` (Bahrain month, ADR-0007). **Regressed in the uncommitted working tree:** `scripts/reconcile_march.ts` `monthBounds` returns the UTC month again, contradicting ADR-0007 and its own doc comment, apparently to satisfy the stale `reconcile_march.test.ts` assertion. Left as found because it is an existing uncommitted change; restore with `git checkout -- scripts/reconcile_march.ts`. |
| 24 | The March close script posts incorrect journal legs. | Fixed: journal legs are corrected. |
| 25 | March close entries use the wrong effective date. | Fixed: effective date is corrected. |
| 26 | March close logging overwrites earlier output. | Fixed: logs append. |
| 27 | The same amount written as `4.75` and `4.750` could produce different import hashes, bypassing the duplicate check. | Fixed: amounts are converted to integer fils before constructing the duplicate key. |
| 28 | Uploading the same adjustment file again could apply the same balance changes a second time. | Fixed: the importer detects an already-processed file and stops before posting it again. |
| 29 | Marketplace seed fee differs from settlement fee by one fil. | Fixed: seed fee matches settlement calculation. |
| 30 | Refund endpoint is only a stub despite refund processing support existing. | Partially addressed: merchant-scoped refund route was added; legacy `/v1/refunds` remains 501 as required by API instructions. |
| 31 | Two simultaneous partial refunds could each see the full remaining amount and together refund more than the card capture. | Fixed: refund processing locks the transaction and checks the remaining refundable balance inside the transaction. |
| 32 | A later refund could ignore earlier refunds and exceed the captured amount. | Fixed: prior successful refunds are subtracted when calculating the remaining cap. |
| 33 | Several partial refunds could reverse more fee than was originally charged. | Fixed: cumulative fee reversal is capped at the original fee, with partial amounts calculated consistently. |
| 34 | A discounted payment could have its refund fee reversed using the undiscounted fee basis. | Fixed: fee reversal uses the effective discounted fee basis. |
| 35 | A refund request without a reason could produce an incomplete record or fail validation. | Fixed: a default reason is supplied when the caller omits one. |
| 36 | Merchant settlement totals could still include money that had already been refunded. | Fixed: refund amounts are included when computing settlement net amounts. |
| 37 | A refund crossing settlement windows could be lost from the next amount carried forward. | Fixed: refund effects are included in the carry-forward calculation. |
| 38 | Reports could show captures but omit the associated refunds, overstating activity or balances. | Fixed: reporting consumes refund events and updates the relevant aggregates. |
| 39 | Transactions near midnight could be reported under the wrong business date because reports used UTC. | Fixed: reporting uses Bahrain business-date boundaries. |
| 40 | Reconciliation could count a payout more than once and report an incorrect difference. | Fixed: payout entries are deduplicated/correctly matched during reconciliation. |
| 41 | Reconciliation could miss refunds that had not yet completed, understating refund exposure. | Fixed: pending refunds are included in the reconciliation calculation. |
| 42 | Scheme export could send an amount inconsistent with the required two-decimal truncation. | Fixed: the exported amount is derived from the truncated integer-fils value. |
| 43 | Fils discarded during scheme truncation could disappear from the books instead of being accounted for. | Fixed: the residue difference is journaled to the scheme-rounding-residue account. |
| 44 | Splitting a payout among recipients could lose or misallocate a fil because rounded shares do not sum to the original total. | Fixed: largest-remainder allocation assigns leftover fils so the shares add back to the full amount. |
| 45 | Changing a fee after payout could make a previously paid batch's figures inconsistent with the fee used to pay it. | Fixed: paid batches are protected from fee changes that would alter their settled amounts. |
| 46 | The fee shown to an admin could differ from the rate that applies on the selected effective date. | Fixed in `HEAD` (rate in effect today). **Regressed in the uncommitted working tree:** `currentFeeScheduleDisplay.ts` orders by `created_at` again, so the dashboard shows the latest-entered row (245 bps) instead of the rate in effect (225 bps). Made by a concurrent session; left as found. |
| 47 | CSV export loads the full filtered result into memory. | Reported; intentionally retained: repository guidance says the date filter bounds results and streaming needs resumable-download support. |
| 48 | Test-mode state is not recomputed correctly. | Fixed: state is recalculated from current inputs. |
| 49 | An admin CSV amount could be interpreted at the wrong scale, causing a balance adjustment to be too small or too large. | Fixed in `HEAD` (`parseBhdToFils`). **Regressed in the uncommitted working tree:** `adjustmentCsvParsing.ts` uses `parseDecimalMinor` again, so `4.75` posts 475 fils (10x short), the finance memo's defect. Also violates the repository rule to use `parseBhdToFils`. Made by a concurrent session; left as found. |
| 50 | Promotion discount input could be multiplied/scaled incorrectly, producing the wrong discounted amount. | Fixed: discount conversion uses the correct monetary unit and scaling. |
| 51 | Database migrations for the affected schema gaps were missing/incomplete. | Fixed: migration sequence 0073–0079 and schema corrections 0054/0055 are present. |
| 52 | Balance/rebuild view did not consistently reflect ledger truth. | Fixed: balance view/rebuild follows the ledger design and documented ADRs. |
| 53 | A balance rebuild and settlement cache update could overwrite one another, leaving a stale cached balance. | Fixed: both rebuild paths lock the relevant cache rows in stable ID order before updating them. |
| 54 | A user without the required owner authority could void a transaction. | Fixed: the void route checks the owner role before allowing the operation. |
| 55 | A webhook could be signed over one representation but delivered with different bytes, so receivers reject it or verification becomes unreliable. | Fixed: dispatcher signs the exact serialized body that it sends. |
| 56 | An attacker could submit a forged inbound callback if the receiver did not verify its origin. | Fixed: inbound requests must pass signature verification before processing. |
| 57 | Serializing the payload separately for signing and sending could produce a signature that does not match the delivered body. | Fixed: the same serialized payload bytes are reused for signing and transmission. |
| 58 | Webhook jitter behavior is not handled by the exact-delay assumption. | No product change needed in `HEAD`. The uncommitted working tree adds a `NODE_ENV === "test"` branch to `backoffDelayMs` in production code; it does not even fix the stale test (`npm test` does not set `NODE_ENV`). Made by a concurrent session; left as found. |
| 59 | Import duplicate guard does not cover equivalent numeric representations. | Fixed: parsed amount is used in the import identity. |
| 60 | Rotating an API key could immediately break clients still using the old key during the intended transition period. | Fixed: the previous key remains usable during the configured rotation grace period. |
| 61 | Authentication throttling/attempt behavior permits excess OTP guesses. | Fixed: failed attempts are tracked and limited (see also concurrency defect #5). |
| 62 | Fee adjustment can be applied in the wrong order relative to discount. | Fixed in `HEAD` (discount off the amount, matching Go `ComputeSettlementFee`). **Regressed in the uncommitted working tree:** `discountAdjustment.ts` discounts the fee again, so ledger and settlement fees disagree by a fils on some captures. Made by a concurrent session; left as found. |
| 63 | Fee calculation uses a stale/current rate instead of the transaction's effective rate. | Fixed: effective-date schedule is applied. |
| 64 | Database payout-notification rows can be duplicated before uniqueness is enforced. | Fixed: migration cleans existing duplicates and adds the constraint. |
| 65 | Settlement daemon's “yesterday” date can disagree with its Bahrain business-day comment/behavior. | Fixed: timezone handling uses the business timezone. |
| 66 | Settlement date-window logic can apply an incorrect timezone boundary. | Fixed: window behavior follows the UTC/Bahrain rules documented in architecture and code. |
| 67 | Development Docker configuration leaks into production service behavior. | Fixed: Docker/runtime configuration is corrected. |
| 68 | Seed/configuration values do not match production fee behavior. | Fixed: seed values are aligned. |
| 69 | A missing capture-rollup row could make the reporting worker crash while applying an event. | Fixed: the worker logs the missing checkpoint/rollup condition and handles it without terminating the consumer. |
| 70 | Outbox consumption by numeric ID can skip a lower-ID transaction that commits late. | Open: handover describes commit-order consumption as unfinished; current consumer ordering does not establish commit order. |
| 71 | The v1 refund endpoint returns 501. | Retained by instruction: v1 501 endpoints are reserved stubs and must not be changed. The separate merchant route is available. |
| 72 | `refund.succeeded` is absent from webhook-eligible event types. | Retained by instruction: refund webhooks are explicitly deferred to v1.9. |
| 73 | Platform processed-volume counter may overflow its integer representation. | Partly fixed (this round): `RecordPlatformProcessedVolume` clamps at 2,147,483,647 instead of wrapping negative. The wrap switched the 15 bps volume-tier bonus off about 147,483 BD after it switched on (threshold 2,000,000,000 fils). Still open: the INTEGER column cannot hold the true total; widening it needs the DBA-approved migration plan. The comments calling it a BD counter, or BIGINT, are wrong: it is fils in INTEGER. |
| 74 | Float32 lifetime-volume estimate can drift at large values. | Retained by instruction: widening/changing the database representation requires DBA/finance approval. |

## Other issues found during verification

These are test-suite or operational findings, not additional product defects in the 74-item count:

- Correction (2026-10-30 review): the Go DB-backed tests skip silently when `DATABASE_URL` is unset (`mustPool` calls `t.Skip`), so a bare `go test ./...` passing proves little. Against a freshly migrated database, `HEAD` fails two tests in `internal/ledger/refresh_test.go`. They assert the pre-ADR-0008 behaviour (cached balance = scheme export lines, no ledger), i.e. the FP-203 defect. These are stale assertions, not product regressions. Reporting passed 11/11 on a clean database; web passed 8/8.
- The full `npm test` run had 7 API assertion failures: four expect 4.75 BD to mean 475 fils rather than 4,750; one expects an outdated fee total; one expects the pre-fix discount result; and one asserts exactly 1,000 ms despite retry jitter.
- The combined run had 4 reporting failures because earlier API tests left malformed empty outbox rows in the shared database; the reporting suite passes by itself on a clean database. This is a test isolation problem.
- One script assertion expects a UTC month boundary although the corrected close uses the Bahrain month.
- A secret was removed from the working tree but remains in Git history; rotate the credential externally.
- Per-service database roles and TLS remain unfinished operational hardening items documented in the handover.

These test mismatches were not “fixed” by editing tests; test files are regression-locked by repository instructions.

## Review round 4 (2026-10-30): new verified findings

Scope: API (auth, payments, refunds, payment links, webhooks, reporting, admin), settlement service, reporting worker, scripts, migrations, web/admin money display, compose. This was a code-reading review backed by runtime checks on disposable databases. It does not prove the rest of the code correct. Each new item below was confirmed by reproducing it, or from a code path with no guard, and each fix was exercised against a migrated Postgres 16 database.

| # | Defect (what could go wrong) | Resolution |
|---:|---|---|
| 75 | `GET /v1/reporting/export-summary` was registered with no auth preHandler. `request.merchantAuth!` was undefined, so every call was a 500. | Fixed: `requireMerchantAuth` added (`routes/reporting.ts`). Unauthenticated → 401, authenticated → 200. |
| 76 | Report scope IDOR: `resolveReportMerchantId` accepted any merchant that is *some* parent's split child. Any merchant could read a marketplace sub-merchant's transactions by putting its id in the report filter. | Fixed: the child must belong to the caller (`parent_merchant_id = caller`) (`reporting/scope.ts`). |
| 77 | The payout disbursement record (`settlement_payout_disbursements`) was written by the webhook dispatcher as a "pre-delivery effect" of the first `settlement.paid` delivery. Result: one row per active endpoint, another per replay or archive restore (each a new delivery at attempt 0), and none for merchants without an endpoint. Migration 0057 says it is written inside PayoutBatch, one per paid batch. | Fixed: written in `PayoutBatch` and `PayoutSplitBatch` in the payout transaction; removed from `dispatcher.ts`. Verified: two payout calls → exactly one row. |
| 78 | `run-batch` (admin console, internal API, CLI) accepted today or a future date. Closing an open business day froze and paid the batch, and every later capture that day was stranded unsettled: the closed batch is a no-op on re-run, and the next day's window does not reach back. | Fixed: `ErrBusinessDayNotComplete` in `CloseBatch` and `RunDailyBatch`; the internal API answers 400 `business_day_not_complete`. Daemon unaffected (it closes yesterday). |
| 79 | Admin **Rebuild analytics** (`refreshAnalyticsRollups`) rebuilt rollups from `transaction_events`. That zeroed every refund total (`refund_count`, `refund_gross_fils`), and it double-counted captures the reporting worker had not consumed yet, because the worker applied their outbox events on top. | Fixed: rebuilds from the outbox up to the reporting consumer's watermark, under the TRUNCATE lock, with the same buckets the worker uses. Verified: refunds kept, events past the watermark not counted. |
| 80 | `scripts/expire_holds.ts`: on a night with no expired holds, `buildWhere` dropped the empty `id` list and the script ran `DELETE FROM holds`, wiping every hold including live ones. SELECT and DELETE were also separate, unlocked statements. | Fixed: an empty list matches nothing (`WHERE FALSE`) in `scripts/lib/sqlFilter.ts`; the script skips the DELETE when nothing matched and runs in one transaction with `FOR UPDATE`. Verified with a live hold and zero expired: nothing deleted. |
| 81 | Merchant dashboard `bhd()` threw a RangeError on negative amounts. Refund timeline events are negative (0044) and reconciliation gaps can be, so the detail page of every refunded transaction and the reconciliation page failed to render. | Fixed: `toFils(..., { allowNegative: true })` in `apps/web/src/format.ts`, as the admin console already does. |
| 82 | Merchant OTP verify promoted the session to 12 h but never re-issued the cookie, which kept the pending 10-minute `maxAge`. Merchants were logged out 10 minutes after login. | Fixed: the cookie is re-issued with `sessionTtlHours`, as admin verify does (`routes/auth.ts`). Verified end to end on 2026-10-30. The merchant session lifetime has since been changed to 48 h, which this re-issue carries to the browser as `Max-Age=172800` (`docs/authentication/SESSION_POLICY.md`). |
| 83 | Business-profile PATCH used any body key as a column lookup. An unknown key produced `UPDATE … SET undefined = $2`, a 500. | Fixed: only `PATCHABLE_COLUMNS` keys are applied (`onboarding/businessProfile.ts`). |
| 84 | `GET /v1/transactions` and `/export` passed `new Date("garbage")` to Postgres, giving a 500, although the route documents a 400. | Fixed: invalid `from`/`to` → 400 (`routes/transactions.ts`). |
| 85 | KYC file/thumbnail download put the stored filename raw into `Content-Disposition`. Node rejects non-latin-1 header characters, so an Arabic filename made the download a 500, and a `"` broke the header. | Fixed: ASCII fallback plus RFC 6266 `filename*` (`routes/kyc.ts`). |
| 86 | `ops/docker-compose.yml` published Postgres on all interfaces (`5432:5432`) with the committed dev password, and the hosted box runs this same file. | Fixed: bound to `127.0.0.1`. |
| 87 | Signup and profile PATCH sent unvalidated `businessType` to the DB CHECK, so an unknown value was a 500. | Fixed: validated in `routes/businessProfile.ts` → 400. |
| 88 | Negotiated-discount double credit: `applyCaptureDiscountAdjustment` compared "adjustments < capture events" and then adjusted the *latest* capture. Once one capture was owed nothing (its discount rounds to 0), replaying that capture's idempotency key credited the latest capture's discount again. Reproduced: 100-fils capture, then 1,000-fils capture at 250 bps / 10% discount, then a replay of the first → merchant credited 2.500 BD twice. | Fixed: adjustments are matched to the capture events owed one, oldest first (`payments/discountAdjustment.ts`). Replay now credits nothing. The fix is independent of the fee formula: the live file keeps the other session's fee-first formula (row 62), and the patch applies the same fix on `HEAD`'s formula. |
| 89 | Inbound acquirer signature was checked over `JSON.stringify(parsed body)`, not the bytes received. A correctly signed callback with whitespace, escaped unicode or `1.0`-style numbers failed with 401 (the incident log's "the incoming signature check has its own problems"). | Fixed: the callback route keeps the raw body and verifies it; tampering still fails with 401, malformed JSON → 400 (`routes/acquirerCallbacks.ts`, `webhooks/inboundVerify.ts`). |
| 90 | Credit requests accepted a future `effectiveDate`, although the draft's contract says it is rejected. The ledger legs are dated at the effective date, so the credit landed in a reconciliation period that had not happened yet. | Fixed: a date after today's Asia/Bahrain business date → 400 (`admin/creditRequestValidation.ts`). |
| 91 | `PayoutSplitBatch` never updated the lifetime payout monitoring estimate that `PayoutBatch` updates, so marketplace parents were missing from it. | Fixed (`splits/allocate.go`). |
| 92 | The admin console's default run-batch date took the browser-local "yesterday" and printed it as a UTC date. From 00:00 to 03:00 Bahrain time it defaulted to two days ago. | Fixed: the default is the last completed Asia/Bahrain day (`apps/admin/src/pages/settlement/SettlementPage.tsx`). |

## Consolidated from FIXES.md (2026-10-30)

`docs/FIXES.md` records two fixed defects that were not yet in this inventory. Both were fixed in commit `a4be087`, and both were confirmed against the current code (`apps/api/src/paymentLinks/pay.ts`) and its Git history.

| # | Defect (what could go wrong) | Resolution |
|---:|---|---|
| 93 | A slow pay attempt let a second buyer re-claim the same payment link once the reservation timeout passed, although the first attempt was still running at the acquirer. Both cards were captured, and the losing attempt still answered 200 (incident 2026-05-14). | Fixed: each pay attempt holds a per-token session advisory lock (`pg_try_advisory_lock`) for its whole duration. A concurrent attempt gets 409 `payment_link_processing`. Postgres releases the lock if the process dies, so the stale-reservation re-claim now only recovers an attempt that is really gone (`paymentLinks/pay.ts`). Exercised by the checkout browser suite on 2026-10-30: a real payment, then "already paid" on reload. |
| 94 | The public pay endpoint judged link expiry against the client-supplied `submittedAt`. Because it came from an unauthenticated body, anyone could pay an expired link by sending an old timestamp (FP-187). | Fixed: expiry is judged on the server clock only (`expiryCheckTime = new Date()` in `paymentLinks/pay.ts`). |

### Uncommitted working-tree regressions (not made by this review)

During this review another agent session edited the same working tree, and several edits revert fixes recorded in `HEAD`, apparently so the stale, locked tests pass. They are left as found per the instruction not to overwrite existing changes; see rows 23, 46, 49, 58 and 62. The same session also changed `apps/reporting/src/consumer/applyEvent.ts` to skip malformed events silently. That breaks the consumer's documented all-or-nothing pass (the `runConsumerPass: atomicity` test fails on the live tree) and leaves `npm run typecheck` failing in `apps/reporting` (TS2345 at line 132). Review these before committing anything. Later it also changed `apps/reporting/package.json` so `npm test` runs `db/seed/index.ts` first. That script truncates the ledger, merchants and admin users in whatever database `DATABASE_URL` names, so running the tests against a real database would destroy it. Revert it before anyone runs `npm test`.

### Plausible but unconfirmed (not counted as defects)

- Webhook URLs are only required to be https in production; there is no private-address check. "Send test event" returns the receiver's response body, so an internal https host could be read. Compose's internal services are plain http, which limits this today.
- One malformed outbox event stops the reporting worker indefinitely (head-of-line). Needs a dead-letter policy, not a silent skip.
- `RecalculateMDR` re-prices at the current flat `mdr_bps`, ignoring fee schedules and the tier bonus that `CloseBatch` used. The locked test name says "at current rate", so this may be intended.
- The capture route has no merchant role gate, so a `support` user can capture.
- No rate limit on password login, so OTP guesses are bounded per login only.

### Intentional or false positives (excluded)

`PGCONN_SETTLEMENT` overriding `DATABASE_URL` is locked by `config_test.go`; only the ops README wording disagrees. `dayStartIso` uses a UTC day by design and is test-locked. Unused `recordCaptureMetric` in `capture.ts` is dead code, not a defect. Credits back-dated to the effective date match ARCHITECTURE ("Corrections are … posted with the effective date"). Items 1–3, 16–17, 47, 71 and 72 are retained by explicit instruction.

### Totals (whole inventory, items 1–94)

- **Confirmed defects fixed in `HEAD` + this review's patch:** 81 (61 prior + 18 new, 75–92, + 2 consolidated from `FIXES.md`, 93–94). Item 73 is additionally partly fixed. Four of the prior fixes (23, 46, 49, 62) are currently reverted in the uncommitted working tree.
- **Confirmed defects left open, with reason:** 10. Items 1–3, 16, 17 (`Math.random`, `displayName` comparison: explicit instruction); 71, 72 (v1 501 stub, refund webhook deferral: explicit instruction); 73 (column width: needs an approved migration plan); 74 (REAL lifetime estimate: needs DBA approval); 70 (commit-order outbox consumption: design work). Item 30 is partially addressed (merchant route live; v1 stub retained by instruction).
- **Intentional behaviours / false positives excluded:** item 47 plus the five in the section above; 58 needs no product change.
- **Test or environment problems (separate from product defects):** 7 stale API assertions; 4 reporting failures from shared-database contamination (11/11 alone); 1 stale scripts assertion (UTC month); 2 stale Go assertions (`refresh_test.go`, pre-ADR-0008); Go DB tests skip without `DATABASE_URL`; reporting typecheck currently broken by the concurrent working-tree edit.
