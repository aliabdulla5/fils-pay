# FilsPay — Currency Handling Audit (BHD frontend, fils backend/database)

**Date:** 2026-10-30 · **Branch:** `redesign/ui-ux` · **Type:** read-only audit against the mandatory currency rule. **No code, schema or data was changed.**

## The rule (summary)

| Layer | Required unit |
|---|---|
| Frontend (inputs, displays, labels) | **BHD**, three decimals, e.g. BHD 10.250. Fils never shown to users. |
| API boundary | Requests in BHD, validated and converted to integer fils immediately. Responses in BHD. Every money field has an explicit unit. |
| Backend calculations | **Integer fils only**, no floating point |
| Database | **Integer fils only**, no BHD decimals, no floating point |

## Verdict at a glance

| Layer | Status | Violations |
|---|---|---|
| Database | **Mostly compliant.** 26 `*_fils BIGINT` columns. | **3**: a `REAL` money column, a `NUMERIC(10,2)` BHD column, and a 32-bit `INTEGER` counter |
| Backend calculations | **Mostly compliant.** Integer `Fils` type, banker's rounding, string BHD parser exist. | **6**: wrong-scale CSV parser (Critical), float fee estimate feeding reconciliation, an ambiguous-unit refund notifier, float32/float64 in Go, a float in the seed, a fee-formula mismatch |
| API boundary | **Non-compliant by design today.** The whole contract is in fils. | 8 money inputs and every money response field are fils. 2 response fields have no unit. |
| Frontend | **Display compliant, input non-compliant.** Every amount is *displayed* in BHD. | **4 forms ask users to type fils.** 7 user-visible texts mention fils. 2 API error messages say "fils". |

The good news: the database already stores integer fils, so **no existing monetary data needs re-scaling**. The work is at the edges: API, forms, and three columns.

---

## 1. Database

| Table.column | Type today | Unit | Rule | Evidence | Migration risk |
|---|---|---|---|---|---|
| 26 columns named `*_fils` (`transactions.amount_fils`, `captured_fils`, `refunded_fils`, `payment_links.amount_fils`, `refunds.amount_fils`, `fee_reversed_fils`, `settlement_batches.*_fils`, `ledger_entries.amount_fils`, `merchant_balances.cached_payable_fils`, `credit_requests.*_fils`, `adjustment_import_rows.parsed_amount_fils`, `merchant_daily_volume.*_fils`, …) | `BIGINT` | fils | ✅ | `grep` of `db/migrations/*.sql`: 26 `*_fils BIGINT` | None |
| `merchants.lifetime_net_payout_monitoring_estimate` | **`REAL`** (float32) | fils, as a float | ❌ floating-point money | `0040_…estimate.sql:7`. Written by Go `payout_estimate.go:19` and `splits/allocate.go:171` as `float32(netPayoutFils)` | **Data is already lossy.** float32 is exact only to 16,777,216 fils (16,777.216 BD); local Delta Wholesale Traders = 1,195,767,600. **Recompute** from `settlement_batches` (sum of paid `net_payout_fils`) into a new `BIGINT` column. Do **not** cast the `REAL`. |
| `scheme_export_lines.amount` | **`NUMERIC(10,2)`** | BHD, 2 decimals (acquirer file format) | ❌ BHD decimal in DB | `0050_…acquirer_amount.sql:13-17` | **Latent rounding bug.** The backfill `amount_fils::numeric / 1000` *rounds* on assignment; verified read-only: `12.345 → 12.35` (truncation gives `12.34`), `0.999 → 1.00` (truncation `0.99`). Today all **1,305** lines agree with truncation (amounts are already multiples of 10 fils), so no corrupted data. Recommend deriving the file amount from `amount_fils` at export time and dropping the column. Low data risk. |
| `platform_stats.total_processed_fils` | **`INTEGER`** (32-bit) | fils | ⚠️ integer, but too narrow | `0049_platform_stats.sql:7`; inventory #73 (clamped at 2,147,483,647) | `ALTER … TYPE BIGINT` on a one-row table. The true total since the clamp is lost; recompute from `settlement_batches` if needed. Needs DBA sign-off (repo rule). |
| `adjustment_import_rows.raw_amount_text` | `TEXT` | the original CSV text | ✅ acceptable | `0066` | Audit evidence of what the operator typed. Not used in calculations. Keep. |

---

## 2. Backend calculations

| # | Location | Violation | Severity | Notes |
|---|---|---|---|---|
| B1 | `apps/api/src/admin/adjustmentCsvParsing.ts:3,8` → `lib/decimal.ts:4` (`decimals = 2`) | BHD text parsed at **2-decimal scale**: `4.750` → 475 fils | **Critical** | Business audit C1. Replace with `parseBhdToFils`. Delete `lib/decimal.ts` (its only caller). |
| B2 | `apps/api/src/fees/estimate.ts:6-10`, used by `settlement/query.ts:351` | **Floating-point fee** (`amountFils * mdrBps / 10_000`, `Math.round`), discount off the fee | **High** | Feeds reconciliation's "pending, not yet batched", and therefore `gapFils`. It disagrees with the real fee (integer `applyRateFils`, banker's rounding, discount off the amount), so it can create unexplained gaps. Replace with the shared integer fee function. |
| B3 | `apps/api/src/admin/settlementClient.ts:282-299` `notifySettlementRefundAdjustment` | Field named `amountFils` carries **`Math.round(amountFils / 10)`** (hundredths of a BHD) | High (latent) | Ambiguous unit and a 10× trap. **Dead code today:** no callers, and the Go service has no `/internal/refund-adjustment` route. Delete, or fix before anyone wires it. |
| B4 | `apps/settlement/internal/settlement/payout_estimate.go:19,28-46`, `splits/allocate.go:171` | `float32` money (monitoring estimate, `EstimateMonthlyPayout`) | Medium | Monitoring only, per the comments, but the rule forbids float money. Use `int64` fils. `CLAUDE.md` *instructs* float32 for display amounts, which conflicts with this rule. |
| B5 | `apps/settlement/internal/settlement/scheme_export.go:29-30` `SchemeAmountBD` → `batch.go:345` | `float64(fils) / 1000.0` written into the `NUMERIC(10,2)` column | Low | Safe today (inputs are multiples of 10 fils), but it's float money written as BHD. Removed by fixing the §1 column. `formatFilsAsTwoDecimalString` (`scheme_export.go:107`) already does it with integers. Use that for the file. |
| B6 | `db/seed/generate.ts:536,615` | `/ 1000` float division to fill `scheme_export_lines.amount` | Low | Seed only. Goes away with the §1 column. |
| B7 | `payments/discountAdjustment.ts:73` vs Go `discounted_fee.go:7-9` | Integer, but a **different formula**, so ledger and settlement fees disagree by up to 1 fil | High | Business audit H1. Not a unit problem, but it breaks "no rounding errors across calculations". |
| B8 | ~50 `Number(row.*_fils)` conversions of `BIGINT` strings (`apps/api/src`, `apps/reporting/src`) | `BIGINT` → JS number | Info | Exact below 2^53 fils (≈ 9 trillion BD), so not a defect. Recommend one helper (`filsFromDb`) that asserts the safe-integer range. |

**Already compliant** (keep as the reference patterns):

- `packages/money` (`toFils` safe-integer guard, `applyRateFils` banker's rounding, `parseBhdToFils` string parser rejecting more than 3 decimals, `formatBhd`)
- capture, refund, credit and settlement fee paths in integer fils
- the transactions CSV export, already in BHD (`transactions/exportCsv.ts:46`: `amount_bhd,captured_bhd`)

---

## 3. API boundary

### 3.1 Endpoints that **accept** money (all in fils today)

| Endpoint | Field today | Unit | Who calls it |
|---|---|---|---|
| `POST /v1/merchants/:id/payment-links` | `amountFils` | fils (number) | Dashboard, **merchant API keys** |
| `POST /v1/transactions` (authorize) | `amountFils` | fils | **API keys only** |
| `POST /v1/transactions/:id/capture` | `amountFils` (optional) | fils | Dashboard, API keys |
| `POST /v1/merchants/:id/refunds` | `amountFils` (optional) | fils | Dashboard, API keys |
| `POST /v1/admin/merchants/:id/credits` | `baseAmountFils` | fils (the admin UI converts BHD → fils **in the browser**) | Admin console |
| `POST /v1/admin/merchants/:id/balance-adjustments` | `deltaFils` | fils (typed by the operator) | Admin console |
| `POST /v1/admin/adjustment-imports` | CSV `amount` column | **BHD text** ✅, but parsed at the wrong scale (B1) | Admin console |
| `POST /v1/payment-links/:token/pay` | none (amount comes from the link) | — | Public checkout |

### 3.2 Endpoints that **return** money (all fils today)

| Group | Fields |
|---|---|
| Transactions, events | `amountFils`, `capturedFils`, `refundedFils`, `amountFils` (event deltas, negative for refunds) |
| Payment links (merchant and public) | `amountFils` |
| Settlement batches, lines, summary, reconciliation | `grossFils`, `feeFils`, `refundedFils`, `feeReversedFils`, `netPayoutFils`, `authorizedFils`, `capturedFils`, `schemeAmountFils`, `ledgerMerchantPayableNetFils`, `settlementNetPayoutFils`, `pendingUnbatchedFils`, `gapFils` |
| Analytics | `capturedGrossFils`, `grossFils`, `feeFils`, `netPayoutFils`, `amountFils` |
| Admin | `cachedPayableFils`, `baseAmountFils`, `feeReversalFils`, `postedAmountFils`, `deltaFils`, `cachedPayableFilsBefore/After`, `oldFeeFils`, `newFeeFils`, `diffFils`, `parsedAmountFils`, `totalPostedFils` |
| **Webhook payloads** (`webhooks/envelope.ts`) | `amountCapturedFils`, `feeFils`, `capturedTotalFils`, `amountFils`, `feeReversedFils`, `refundedTotalFils`, `netPayoutFils` |

Totals: 14 distinct `*Fils` fields in the merchant DTOs and 13 in the admin DTOs.

### 3.3 Ambiguous-unit fields (violate "never allow unclear units")

| Field | Where | Unit actually carried |
|---|---|---|
| `before`, `after` | Balance-rebuild response (`admin/settlementClient.ts:26-27`, `apps/admin/src/types.ts:220-221`) | fils, with no suffix |
| `amountFils` | `notifySettlementRefundAdjustment` (B3) | hundredths of a BHD, despite the name |

### 3.4 Conflicts to resolve before changing the contract

The rule asks for BHD in requests and responses. Doing that **in place** would break things the repository protects:

1. **Merchant integrations.** API-key clients and webhook receivers already parse `*Fils` integers. A silent switch to BHD would make every amount 1000× off for them.
2. **Locked tests.** `CLAUDE.md` forbids modifying existing test files, and the API suite (50 test files) asserts fils fields.
3. **JSON numbers are binary floats.** `10.250` sent as a JSON number is a float on the wire, which the rule itself forbids for money.

**Recommended contract (needs approval):**

- **BHD travels as a decimal string with an explicit name:** `"amountBhd": "10.250"`. Validated by the existing `parseBhdToFils` (≤ 3 decimals, no floats) and converted to fils immediately at the boundary.
- **Additive, not breaking:**
  - Responses gain `*Bhd` string fields next to the existing `*Fils` fields; the dashboard and admin read only `*Bhd`.
  - Requests accept `amountBhd`, and also `amountFils` during a published deprecation window for API-key clients.
  - Or put BHD-only contracts under `/v2` and freeze `/v1`.
- **Every money field carries its unit in its name** (`…Bhd` or `…Fils`). Fix the 2 ambiguous fields above.
- Add a short **API money contract** section to `docs/ARCHITECTURE.md` listing each endpoint's fields and units.

---

## 4. Frontend

### 4.1 Forms where users type **fils** (violations)

| App | Screen | Field | Evidence |
|---|---|---|---|
| Web | New payment link | "Amount in fils" + `fils` suffix | `PaymentLinkCreatePage.tsx:92,103`; validation message `:43` |
| Web | Transaction → Capture | "Amount in fils" | `TransactionDetailPage.tsx:188,199` |
| Web | Refund drawer | "Amount in fils"; placeholder shows the refundable amount in fils | `RefundDrawer.tsx:176,189,192` |
| Admin | Merchant → Adjust balance | "Delta (fils, may be negative)" | `MerchantDetailPage.tsx:753,761`; validation message `:133` |
| Admin | Merchant → Issue credit | BHD ✅ (converted with `parseBhdToFils` **in the browser**) | Move the conversion server-side under the new contract |
| Admin | Import adjustments | BHD in the CSV ✅ (the server mis-parses it, B1) | — |

### 4.2 User-visible text mentioning fils

- `PaymentLinkCreatePage.tsx:43,106`: "positive whole number of fils", "1000 fils = 1.000 BHD"
- `RefundDrawer.tsx:192`: "1000 fils = 1.000 BHD"
- `SettlementBatchDetailPage.tsx:148`: "up to 9 fils below the captured amount". This is an accurate scheme rule; rephrase as "up to BHD 0.009".
- API errors shown verbatim by `describeError`: `routes/refunds.ts:63` ("integer number of fils") and `routes/adminBalanceAdjustments.ts:30`

### 4.3 Display

**Compliant.** Every amount on screen goes through `bhd()` / `formatBhd()` (`Money` components in both apps, checkout), always with three decimals. The format today is **`10.250 BHD`** (suffix); the rule's example is **`BHD 10.250`** (prefix). **Decision needed:** pick one and apply it in the shared formatter only.

### 4.4 Frontend code

`apps/web/src/types.ts` and `apps/admin/src/types.ts` mirror the fils wire format, and pages pass `fils` numbers to `Money`. Under the new contract these become `string` BHD fields, displayed without arithmetic. No float maths was found in either frontend: all conversions use `@filspay/money`.

---

## 5. Validation and tests to add

Existing test files are locked (`CLAUDE.md`), so add new files such as `money-boundary.new.test.ts`:

| Case | Input (BHD) | Expected |
|---|---|---|
| Whole and fractional | `1.000` / `10.250` / `0.001` | 1000 / 10250 / 1 fils |
| Short fractions | `4.7`, `4.75`, `4` | 4700, 4750, 4000 |
| Precision overflow | `1.0001` | 400 `invalid_amount` |
| Zero | `0`, `0.000` | 400 where a positive amount is required (links, capture, refund, credit); allowed nowhere else |
| Negative | `-1.000` | 400 everywhere except balance adjustments and import rows |
| Non-numeric and formats | `1,000.500`, `BHD 10.250`, `10.25 `, `""`, `1e3` | 400, except trimmed whitespace, which is accepted |
| Maximum | above `Number.MAX_SAFE_INTEGER` fils; above the business maximum (PO to set, e.g. BHD 5,000.000 per link) | 400 |
| Round trip | `formatBhd(parseBhdToFils(x)) === canonical(x)` for 10,000 random values | always true |
| Fee consistency | API fee == Go `ComputeSettlementFee` for a grid of amounts, MDRs and discounts | always equal (fixes B7) |
| Repeated partial refunds | 3 partial refunds then a full refund | the sum never exceeds the capture; total fee reversal ≤ original fee |
| Scheme amount | `12.345` → file `12.34`, residue `5` fils journaled | matches ADR-0002 |

---

## 6. Migration risks

| Change | Risk | Mitigation |
|---|---|---|
| API contract to BHD | Breaks API-key clients and webhook receivers; breaks locked tests | Additive `*Bhd` string fields or `/v2`; deprecation notice; keep `*Fils` |
| Forms to BHD input | User error during the transition (typing `10250` for BHD 10.250) | Inline preview ("= BHD 10.250"), reject more than 3 decimals, warn on unusually large values |
| `REAL` estimate → `BIGINT` | Existing values are already imprecise | Recompute from settlement history; never cast |
| `NUMERIC(10,2)` scheme amount | The acquirer file format must not change | Generate the file string from integer fils (`formatFilsAsTwoDecimalString`); drop the column after one verified export |
| `INTEGER` counter → `BIGINT` | One-row table; brief lock | Run in a maintenance window; DBA sign-off required by the repo |
| CSV parser fix (B1) | Past imports were posted at 1/10 | **Business decision:** identify imported rows (`adjustment_import_rows.raw_amount_text` vs `parsed_amount_fils`) and post corrective adjustments. No historical rows edited. |
| Fee formula alignment (B7) | Historical ledger fees differ by ≤ 1 fil from settlement | Fix going forward; MDR recalculation or a one-off adjustment for history (PO) |
| `packages/money` | Frozen pending finance sign-off | The plan needs **no** change to it: `parseBhdToFils` and `formatBhd` already exist |

---

## 7. Proposed implementation order (pending authorisation)

1. **Fix the correctness defects first** (no contract change): B1 CSV parser, B2 float estimate, B3 dead notifier, B7 fee formula. Add the §5 tests.
2. **Frontend inputs to BHD**, still sending fils on the current API by converting with `parseBhdToFils`. This removes fils from every screen immediately, with zero API risk.
3. **API boundary:** add `*Bhd` string request and response fields (or `/v2`), document units, fix ambiguous fields, then move the frontends to the BHD fields so conversion happens server-side.
4. **Database:** the three column changes, with DBA approval.

**Decisions needed from you:**

1. Additive `*Bhd` fields or a `/v2` API.
2. Display format: `BHD 10.250` or `10.250 BHD`.
3. Business maximums (per payment link, refund, adjustment).
4. Whether to correct past CSV imports.
5. Authorisation to change code, schema and the frozen-package-adjacent paths.
