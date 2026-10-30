# FilsPay — Business Logic & Product Completeness Audit

**Date:** 2026-10-30 · **Branch audited:** `redesign/ui-ux` (application code identical to `main` at `185aac3`, plus UI-only commits) · **Type:** read-only audit. No application code, schema or data was changed.

FilsPay is evaluated here as a hackathon fintech product: does it behave like a coherent payment platform for Bahraini merchants, not only render correctly.

---

## 0. Method and conventions

**Evidence sources:** API source (`apps/api/src`, Fastify + `pg`), the Go settlement service (`apps/settlement`), 73 SQL migrations (`db/migrations`), the money package (`packages/money`), both frontends, the existing defect register (`docs/BUG_INVENTORY.md`), and read-only `SELECT` queries against the local dev database.

**How findings were confirmed:**

- **Executed:** the real function was run with real inputs (e.g. `parseAdjustmentAmountFils("4.75")`).
- **Code-confirmed:** a code path with no guard, cited by file and line.
- **Query-confirmed:** read-only SQL against the local stack.

**Labels used throughout:**

| Label | Meaning |
|---|---|
| **Confirmed defect** | The product does something wrong today. Fixable without new business requirements. |
| **Needs product-owner decision** | The behaviour is defensible, but a fintech product would usually do otherwise. Not a defect until the PO decides. |
| **Retained by instruction** | A known issue the repository's own guidance (`CLAUDE.md` / `BUG_INVENTORY.md`) explicitly keeps. Reported for visibility only. |

**Priorities:** Critical (money posted wrong, or data loss), High (financial integrity or access control), Medium (correctness or validation gap a user can hit), Low (hygiene, docs, edge cases).

> **Do not trust the repository docs blindly.** Three documents contradict the code:
> - `CLAUDE.md:22` says money is "integer **cents** (1 BD = 100 cents)". The money package says BHD has three decimals, 1 BD = **1000 fils** (`packages/money/src/fils.ts:2`), and `formatBhd(4750)` returns `4.750`. This wrong guidance plausibly caused finding **C1**.
> - `CLAUDE.md` says impersonation is gated to `super_admin`. The route allows any admin role (`routes/adminMerchants.ts`, `"/:id/impersonate"` → `requireAdminSession` only).
> - Migration `0020_payment_links.sql` says link tokens come from `crypto.randomBytes`. The code uses `Math.random()` (`paymentLinks/create.ts:12` → `lib/random.ts:13`).

---

## 1. Actual architecture

| Part | What it is |
|---|---|
| `apps/api` | Fastify REST API (`/v1/*`), Postgres via `pg`. Merchant plane (`fp_sid` cookie or API key), admin plane (`fp_admin_sid`), public checkout endpoints, signed acquirer callbacks, webhook dispatcher. |
| `apps/settlement` | Go service: daily batch close (`CloseBatch`), payouts, scheme export with two-decimal truncation, MDR recalculation, balance rebuild. Reference implementation for fees (`CLAUDE.md`). |
| `apps/reporting` | Outbox consumer that maintains analytics rollups (`merchant_daily_volume`, payout trends). |
| `apps/web` | Merchant dashboard (`/dashboard/*`) and public checkout (`/pay/:token`). |
| `apps/admin` | Internal admin console. |
| `packages/money` | Branded integer `Fils` type, `parseBhdToFils`, `formatBhd`, banker's rounding. Audited and frozen. |
| `packages/ui` | Design tokens and self-hosted fonts. **CSS only: there are no shared React components** (the brief assumes there are). |
| `packages/events` | Outbox event types. |

**Money model:** `BIGINT` integer fils everywhere. Every `amount_fils` column has `CHECK (> 0)`, and `currency CHAR(3) CHECK (currency = 'BHD')` on `transactions` and `payment_links`. Double-entry `ledger_entries` (migration 0007). Single-currency by design.

---

## 2. Findings summary

| ID | Priority | Finding | Status |
|---|---|---|---|
| C1 | **Critical** | Adjustment CSV import posts **one tenth** of every amount | Confirmed defect (executed) |
| H1 | High | Negotiated-discount fee: API ledger and Go settlement disagree by up to 1 fil per capture | Confirmed defect (executed) |
| H2 | High | Suspended or closed merchants can still take payments; no way to suspend from the console | Confirmed defect |
| H3 | High | Maker-checker gaps: self-approval compares display names; threshold ignores fee reversal; balance adjustments have no second approver | Mixed (see detail) |
| H4 | High | Role matrix inconsistent: support can capture via API, finance sees a Void button that 403s | Confirmed defect + PO decision |
| H5 | High | `apps/reporting` `npm test` runs the destructive seed first | Confirmed defect |
| H6 | High | Payment-link tokens and OTPs use `Math.random()` | Retained by instruction |
| M1 | Medium | Webhooks: no event subscriptions, only 3 event types, no private-address (SSRF) check, no duplicate check | Confirmed gap + PO decision |
| M2 | Medium | Refund reason is never captured: the UI never sends it, so every refund is stored as `'unspecified'` | Confirmed + PO decision |
| M3 | Medium | A non-integer `amountFils` on authorize or capture returns 500 instead of 400 | Confirmed defect |
| M4 | Medium | Admin "current negotiated rate" shows the latest-entered schedule, not the one in effect | Confirmed defect (regression #46) |
| M5 | Medium | Refund hold (`refunds_enabled`) has no writer anywhere; its migration contradicts itself on `NULL` | Confirmed gap + PO decision |
| M6 | Medium | `super_admin` has no capability `finance` lacks; impersonation is open to every admin role | PO decision |
| M7 | Medium | Payment links: reference optional and not unique; no length limits; no maximum amount or expiry horizon | PO decision |
| M8 | Medium | Business profile validated for presence only; signup allows the same owner email on a second tenant | Confirmed gap + PO decision |
| M9 | Medium | `scripts/reconcile_march.ts` month boundary uses UTC instead of Bahrain (regression #23) | Confirmed defect |
| M10 | Medium | Platform processed-volume counter is a clamped `INTEGER` (#73) | Open, needs DBA approval |
| L1 | Low | A stale `reserved` link past its expiry is reported publicly as `active` | Confirmed defect |
| L2 | Low | Dead `expiryReferenceTime` helper and a misleading route comment about `submittedAt` | Confirmed (hygiene) |
| L3 | Low | Production dispatcher contains a `NODE_ENV === "test"` branch (regression #58) | Confirmed (hygiene) |
| L4 | Low | Docs contradict code (cents, token entropy, impersonation gate) | Confirmed (docs) |
| L5 | Low | Payment-link detail page only finds links among the 100 most recent | Confirmed limitation (documented in code) |

**Important context:** `docs/BUG_INVENTORY.md` describes several regressions (#23, #46, #49, #58, #62) as "uncommitted working-tree" edits by another session. **They are now committed**, in `ba163fe` ("Add scratch tests for settlement and discount verification"), so they are live in `HEAD` and on every branch built from it. C1, H1, M4, M9, L3 and H5 are those regressions.

---

## 3. Critical and High findings in detail

### C1 · Adjustment CSV import posts one tenth of every amount — Critical, confirmed defect

- **Evidence:**
  - `apps/api/src/admin/adjustmentCsvParsing.ts:3,8`: `toFils(parseDecimalMinor(raw), …)`.
  - `apps/api/src/lib/decimal.ts:4`: `parseDecimalMinor(raw, decimals = 2)`. Two decimals is a cents parser.
- **Executed against the real function:**

  | CSV amount | Posted by import | Correct (`parseBhdToFils`) |
  |---|---|---|
  | `4.75` | 475 fils (0.475 BD) | 4,750 fils (4.750 BD) |
  | `4.750` | 475 fils | 4,750 fils |
  | `100` | 10,000 fils (10.000 BD) | 100,000 fils |
  | `0.001` | **0 fils** | 1 fil |
  | `-12.500` | -1,250 fils | -12,500 fils |

- **Impact:** a finance operator importing "Coral Bay Traders, 37.500, statement correction" credits **3.750 BD** instead of 37.500 BD. The ledger is internally balanced, so nothing alarms; the merchant is simply short-paid. The duplicate-file guard (#28) stores the hash of the wrong amount, so a corrected re-upload is treated as new.
- **History:** fixed in an earlier `HEAD` (BUG #49), then reverted and committed in `ba163fe`.
- **Fix:** use `parseBhdToFils` (`packages/money/src/fils.ts:282`), as `CLAUDE.md`'s own Money section requires. A new test such as `adjustmentCsvParsing.new.test.ts` could pin `"4.75"` → 4750 without editing the locked tests. Note that the 7 locked API assertions expect the wrong (475) behaviour (`BUG_INVENTORY.md`, "Other issues").

### H1 · Discounted fee: API ledger ≠ Go settlement — High, confirmed defect

- **Evidence:**
  - API: `payments/discountAdjustment.ts:73` credits `applyRateFils(feeFils, discountBps)`, i.e. the discount is taken **off the fee**.
  - Go: `internal/settlement/discounted_fee.go:7-9`, `ComputeSettlementFee`, takes the discount **off the amount**, then applies MDR.
  - `CLAUDE.md` makes Go the reference: "If the TypeScript API and the Go service disagree on a computed fee, the Go version is correct".
- **Executed:**

  | Capture | MDR | Discount | API net fee | Go fee |
  |---|---|---|---|---|
  | 1.000 BD | 250 bps | 10% | **23 fils** | **22 fils** |
  | 12.750 BD | 250 bps | 10% | 287 | 287 |
  | 3.333 BD | 275 bps | 15% | 78 | 78 |

- **Impact:** for discounted merchants, the ledger's `merchant_payable` and the batch's net payout drift by up to 1 fil per capture. Reconciliation is strict (`settlement/query.ts:367`, `explained: gapFils === 0`), so the merchant sees a non-zero "Gap" they can't explain.
- **History:** this is regression #62, committed in `ba163fe`.

### H2 · Suspended or closed merchants can still take payments — High, confirmed defect

- **Evidence:**
  - `merchants.status IN ('active','suspended','closed')` (`0002_merchants.sql`).
  - `payments/authorize.ts:77-87` checks only `onboarding_status === "approved"`.
  - A search of `apps/api/src` finds no code reading `merchants.status` on any money path. The only `'closed'` matches are settlement-batch statuses.
  - There is also no admin route to change `merchants.status`.
- **Impact:** a merchant under a fraud or compliance review cannot be stopped from taking card payments or creating payment links. The status column is decorative.
- **Recommendation:**
  - Reject authorize, capture, link creation and pay with `403 merchant_suspended` when `status <> 'active'`.
  - Add an audited admin action to suspend or reinstate (see Feature 7).
  - Whether a suspended merchant may still **refund** is a PO decision; usually yes, to let customers be made whole.

### H3 · Maker-checker gaps in admin money movement — High

| Gap | Evidence | Status |
|---|---|---|
| The self-approval check compares **display names**, so two admins named "Fatima Al-Khalifa" are treated as one person. A renamed admin could also approve their own request. | `admin/creditApproval.ts:11`: `approver.displayName === requester.displayName` | **Retained by instruction** (BUG #16, #17); needs PO and security sign-off to switch to `admin_user_id` |
| The approval threshold looks at the **base** amount only: a 50.000 BD credit with fee reversal posts 50.000 + MDR BD on one approver. | `admin/creditThreshold.ts:13-15` compares `baseAmountFils` with 50,000 fils; the posted total is `base + feeReversal` (`types.ts`, `postedAmountFils`) | **Needs PO decision** (is the limit on the base or the posted total?) |
| **Balance adjustments** of any size by one finance operator, with no second approver, while credits above 50 BD need two. Both move `merchant_payable`. | `routes/adminBalanceAdjustments.ts:26-36` (non-zero integer and non-empty reason only); `admin/balanceAdjustments.ts:82` posts a ledger adjustment | **Needs PO decision**: recommend the same threshold and maker-checker as credits |

Query evidence that this matters: today's local audit log shows 2 balance adjustments and 7 credit requests by admin accounts. These weren't made by the QA runs; see §9.

### H4 · Merchant role matrix is inconsistent — High

Server enforcement (`preHandler` on each route) versus what the dashboard shows:

| Action | Server allows | Dashboard shows to | Result |
|---|---|---|---|
| Capture (`POST /v1/transactions/:id/capture`) | **any** merchant role (`requireMerchantAuth` only) | owner, finance | Support can capture through the API or a script |
| Void (`/:id/void`) | **owner only** (`requireMerchantRole("owner")`) | owner, **finance** | **Finance clicks Void and gets 403** (confirmed defect) |
| Refund (`/:merchantId/refunds`) | owner, finance | owner, finance | Consistent |
| Create or cancel payment link | owner, finance | owner, finance | Consistent |

- The dashboard says the capture gap is deliberate (`TransactionDetailPage.tsx`: "this hide is NOT backed by a matching server-side role check").
- **Recommendation (PO decision):** one rule for "moves money": owner and finance for capture, void and refund. That also fixes the finance Void 403.

### H5 · Reporting tests wipe the database first — High, confirmed defect

- **Evidence:** `apps/reporting/package.json:9`: `"test": "tsx ../../db/seed/index.ts && tsx --test …"`. The seed truncates `ledger_entries`, `transactions`, `merchants` and `admin_users` (`ops/docker-compose.yml` comment).
- **Impact:** running the repo's root `npm test` with `DATABASE_URL` set to a shared or hosted database destroys it.
- **History:** committed in `ba163fe`; `BUG_INVENTORY.md` warns "revert it before anyone runs `npm test`".

### H6 · Guessable tokens and OTPs — High, retained by instruction

- **Evidence:**
  - `paymentLinks/create.ts:11-13` → `randomFromAlphabet` → `lib/random.ts:13`, using `Math.random()`.
  - OTPs use `randomDigits` (`lib/random.ts:4`), also `Math.random()`.
- **Why it matters:** `Math.random()` (V8 xorshift128+) is predictable from observed outputs. Link tokens are the **only** credential on the public checkout (`/pay/:token`).
- **Status:** `CLAUDE.md` explicitly permits this (BUG #1, #3), so a change needs security and PO sign-off. It's reported because the migration documentation claims the opposite.

---

## 4. Required vs optional fields

**Legend:** ✅ correct today · ⚠️ gap · **PO** needs product-owner decision. Unless stated, "DB" means the column constraint in the migration named.

### 4.1 Payment link (dashboard "New payment link"; `POST /v1/merchants/:id/payment-links`)

| Field | Current | Recommended | Business justification | Frontend | Backend | Database |
|---|---|---|---|---|---|---|
| **Amount** | Required, positive integer **fils** (`routes/paymentLinks.ts:82`, `create.ts:36-41`, DB `CHECK > 0`). No maximum. UI asks for fils. | ✅ required. ⚠️ Enter as **BD with 3 decimals** (`parseBhdToFils`) and show the fils value as a hint. **PO:** per-merchant maximum (e.g. 5,000.000 BD) | Merchants think in BD; typing `37500` for 37.500 BD invites 10× mistakes. A cap limits damage from typos and compromised sessions. | BD input, preview (exists) | `parseBhdToFils` + max check → 400 | `CHECK (amount_fils BETWEEN 1 AND …)` once the cap is agreed |
| **Currency** | Not an input. Fixed `BHD` by DB `CHECK (currency = 'BHD')`. | ✅ keep fixed. Show "BHD" in the UI (already shown). | Single-currency platform by design. | Display only | Reject any non-BHD value if the API ever accepts one | Existing CHECK |
| **Reference** | Optional, unbounded `TEXT`, **not unique** (`0020`). | **PO:** recommend **required** for API-created links and strongly prompted in the UI; **unique per merchant among non-canceled links**; ≤ 64 chars; `[A-Za-z0-9 _/#-]`. | Reference is the merchant's order or invoice id: the only way to reconcile "INV-2026-0142" in their ERP against a FilsPay payment. Duplicates make reconciliation ambiguous; `transactions.reference` copies it. | Required field, length counter | 400 `invalid_reference`, 409 `duplicate_reference` | Partial unique index `(merchant_id, reference) WHERE status <> 'canceled'` |
| **Description** | Optional, unbounded `TEXT`, shown to the payer. | Optional, ≤ 140 chars, plain text. | It appears on the public checkout; unbounded text breaks layout and invites abuse. | Counter | 400 if longer | `CHECK (char_length(description) <= 140)` |
| **Expires at** | Required, strictly in the future (`create.ts:43-46`). No horizon. | ✅ required. **PO:** default +7 days; maximum 90 days. | Stale links are a fraud and pricing risk. | Default value, max | 400 `invalid_expiry` | — |

### 4.2 Webhook endpoint (`POST /v1/merchants/:id/webhook-endpoints`)

| Field | Current | Recommended | Justification | Frontend | Backend | DB |
|---|---|---|---|---|---|---|
| **URL** | Required; http(s); https only in production (`webhooks/create.ts:15-27`). No length limit, no private-address check, no duplicate check. | Required, https in all hosted environments, ≤ 2,048 chars, **block private and link-local ranges** (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1), unique per merchant. | "Send test event" returns the receiver's body, so an internal https host could be read (inventory, "plausible"). | Inline URL validation | Resolve the host and reject private IPs at create and at delivery | Unique `(merchant_id, url)` |
| **Event subscriptions** | **Do not exist.** Every active endpoint gets every eligible event (`dispatcher.ts:28`: `transaction.captured`, `transaction.voided`, `settlement.paid`). | **PO:** required non-empty list, default "all". Add `payment_link.paid` and `refund.succeeded` (refund webhooks are deferred to v1.9 by instruction, #72). | Merchants route events to different systems; e-commerce needs `payment_link.paid` to mark an order paid. | Checkbox group | Validate against the known event list | `event_types TEXT[] NOT NULL DEFAULT '{…}'` |

### 4.3 Refund (dashboard refund drawer; `POST /v1/merchants/:id/refunds`)

| Field | Current | Recommended | Justification | Frontend | Backend | DB |
|---|---|---|---|---|---|---|
| **Transaction** | Required UUID, scoped to the caller (`routes/refunds.ts:59`, `initiateMerchantRefund.ts:66-72`). | ✅ | — | — | ✅ | ✅ |
| **Amount** | Optional, meaning a full refund of what remains; positive safe integer fils; capped at refundable under a row lock (#31-33). UI asks for **fils**. | ✅ logic. ⚠️ UI: enter BD with 3 decimals. | Same as payment links. | BD input | Unchanged | ✅ `CHECK > 0` |
| **Reason** | Optional; the **UI never sends it**, so every refund is stored as `'unspecified'` (`0070`). | **PO:** required reason code (`requested_by_customer`, `duplicate`, `fraudulent`, `product_not_delivered`, `other`), with free text required for `other`. | Chargeback defence and acquirer reporting need a reason; "unspecified" on 100% of refunds is useless for audit. | Select + note | Enum validation → 400 | Validate the existing `NOT VALID` CHECK; `CHECK (reason IN (…))` |

### 4.4 Capture and authorize (API, plus the dashboard capture form)

| Field | Current | Recommended |
|---|---|---|
| Capture amount | Optional (full remaining). Non-integer → `toFils` throws `RangeError` → **500** (`routes/transactions.ts:109-114`, `plugins/errorHandler.ts:35`). | ✅ optional. ⚠️ Validate `Number.isSafeInteger && > 0` → **400**, as the refund route already does (`routes/refunds.ts:62`). |
| Authorize amount and card | Required; same 500 on non-integer (`routes/transactions.ts:83-90`). | Same 400 validation. |

### 4.5 Admin: credit, balance adjustment, import

| Form | Field | Current | Recommended |
|---|---|---|---|
| Issue credit | Amount | Required, BD string → `parseBhdToFils` (UI); positive safe integer (API) ✅ | ✅ |
| | Reason code | Required enum ✅ (`creditRequestValidation.ts`) | ✅ |
| | Effective date | Required, real date, not in the future (Bahrain day) ✅ | ✅ |
| | Memo | Optional, ≤ 500 chars ✅ | **PO:** required for `correction` and `dispute_resolution` (auditors ask "correction of what?") |
| | Reverse fee | Optional boolean ✅ | ✅. The threshold question is under H3. |
| Adjust balance | Delta | Required non-zero integer **fils** (no maximum) | ⚠️ enter BD; **PO:** maximum and maker-checker (H3) |
| | Reason | Required non-empty (no length limit) | Add ≤ 500 chars and a reason code, as for credits |
| Import adjustments | File name | Optional | ✅ (defaults handled server-side) |
| | CSV | Required; header `merchantId,amount,reason` | ✅ structure. ⚠️ **amount parser (C1)** |
| | Row reason | **Optional** per row (`adjustmentCsvParsing.ts:49-50`) | **PO:** required, as the single-adjustment form already requires a reason |
| | CSV dialect | No quoting, so a reason containing a comma is silently truncated to the first field | Document it or use a real CSV parser |
| KYC review | Outcome / notes | Outcome required; notes optional | **PO:** notes required on **rejection** (the merchant needs to know why) |

### 4.6 Merchant information (`POST /v1/merchants` signup; business profile PATCH)

| Field | Current | Recommended (Bahrain) |
|---|---|---|
| Legal name, CR number, business type, contact email and phone, address line 1, city | Required; presence only (`routes/businessProfile.ts:33-48`); business type enum ✅ (#87) | Formats: **CR number** in the Sijilat format (confirm the exact pattern with the PO); **phone** `+973` and 8 digits; email syntax; trimmed lengths |
| Address line 2, postal code | Optional ✅ | Bahrain addresses are usually Building / Road / Block / Area: **PO:** structured fields |
| Country | `CHAR(2)` default `BH` ✅ | ✅ |
| Owner email | May repeat across tenants (`routes/businessProfile.ts:28`) | **PO:** allowed by design (users are per merchant), but alert or verify ownership |
| Settlement bank account (IBAN) | **Does not exist** | Required before the first payout; `BH` + 2 check digits + 4 bank code + 14 account (22 chars) with a mod-97 check |

### 4.7 Other forms (verified correct)

| Form | Fields | Status |
|---|---|---|
| Merchant and admin sign-in | merchant ID, email, password, OTP | All required ✅ |
| Overview filters | from, to, top-links limit | Optional, server defaults, limit clamped 1–50 ✅ |
| Reconciliation | from, to | Required (API answers 400 otherwise) ✅ |
| Settlement run-batch | date | Required, a completed business day only ✅ (#78) |
| Settlement run-batch | merchant | Optional ✅ |
| MDR recalculation | merchant, from, to | Required ✅ |
| Webhook replay (admin) | endpoint, from, to | Required ✅ |
| Webhook replay (admin) | statuses | Optional, default `exhausted` ✅ |
| Rotate API key | label | Optional ✅ |
| Checkout card | PAN, expiry, CVV | Required by HTML only. The simulated acquirer accepts any shape. **PO:** client-side Luhn, expiry-in-future and 3–4 digit CVV checks would make the demo convincing without touching the simulator's documented test-card rules. |

---

## 5. Financial correctness

| Area | Assessment | Evidence |
|---|---|---|
| Amount representation | ✅ Integer fils, `BIGINT`, `CHECK > 0`, safe-integer guard in `toFils`. No floats on money paths. | `packages/money/src/fils.ts:35`; migrations 0004, 0020, 0042 |
| BHD precision and formatting | ✅ Three decimals everywhere in the UI (`formatBhd`). ⚠️ `CLAUDE.md` claims two (L4), and the CSV importer uses two (C1). | `fils.ts:233-237` |
| Scheme export | ✅ Intentional two-decimal truncation, with the residue journaled (ADR-0002; #42-43) | `scheme_export.go` |
| Fees | ✅ Effective-dated fee schedules and volume-tier bonus at settlement. ⚠️ Discount formula mismatch (H1). ⚠️ The admin display shows the wrong schedule (M4). | `batch.go:155-230`; `capture.ts:167-197` |
| Refunds | ✅ Partial refunds supported; cap enforced under a row lock; fee reversal capped and pro-rated on the discounted basis (#31-35). ⚠️ Reason never captured (M2). | `refundValidation.ts`, `processRefund.ts` |
| Settlement | ✅ Refunds netted into batch net payout (#36-37); cannot close today or a future day (#78); paid batches protected from MDR recalculation (#45). | `batch.go` |
| Credits | ✅ Validated, journaled, back-dating allowed, future dates rejected (#90). ⚠️ Control gaps (H3). | `creditRequestValidation.ts` |
| Adjustment imports | ❌ **10× under-posting (C1)**. ✅ Duplicate-file guard (#28). | `adjustmentCsvParsing.ts` |
| Reconciliation | ✅ Strict (`explained` iff gap = 0), pending unbatched included (#41). It will surface H1 drift as unexplained gaps. | `settlement/query.ts:358-367` |
| Duplicate operations | ✅ Idempotency keys unique per `(merchant, endpoint, key)` with a request hash, so a reused key on a different body gets 422 (`0019`). Pay holds a per-token advisory lock (incident 2026-05-14). Refund keys are per refund intent. | `0019_idempotency_keys.sql`; `pay.ts:67-88` |
| State transitions | ✅ Link `active → reserved → paid / active`, `active → canceled`; `paid ⇔ transaction_id` enforced by CHECK. ❌ Merchant `status` ignored (H2). ⚠️ Stale-reserved-past-expiry shown as `active` (L1). | `0020`; `status.ts:33-40` |

**Spot-check of real QA data (read-only):** 3 checkout captures of 12.750 BD each for Alpha Retail Co (negotiated 225 bps). Each charged 287 fils (12,750 × 2.25% = 286.875, rounds to 287). Ledger legs balance: `card_scheme_clearing` debit 38,250 = `merchant_payable` credit 38,250; fee legs 861 = 861.

---

## 6. Security and permissions

### 6.1 Merchant plane (server-enforced)

| Capability | owner | finance | support | API key | Admin impersonation |
|---|---|---|---|---|---|
| Read transactions, links, settlement batches, analytics | ✅ | ✅ | ✅ | ✅ | ✅ (read) |
| Reconciliation, settlement summary | ✅ | ✅ | ❌ | — | — |
| Create or cancel payment link | ✅ | ✅ | ❌ | ✅ | ❌ (writer guard) |
| Capture | ✅ | ✅ | **✅ (H4)** | ✅ | ❌ |
| Void | ✅ | **❌ (H4)** | ❌ | role-dependent | ❌ |
| Refund | ✅ | ✅ | ❌ | ✅ | ❌ (explicit check, `refunds.ts:53`) |
| Webhook endpoints (list, create, update, delete, replay) | ✅ | ✅ | ❌ (deliveries read ✅) | ✅ | ❌ |
| API keys | ✅ | ❌ | ❌ | — | — |
| Business profile write and KYC upload | ✅ | ✅ | ❌ | — | — |

### 6.2 Admin plane (server-enforced)

| Capability | support | finance | super_admin |
|---|---|---|---|
| Merchant list and detail, import history, webhook replay and archive | ✅ | ✅ | ✅ |
| **Start impersonation** | ✅ (M6) | ✅ | ✅ |
| KYC review, bulk approve, API-key rotation, credits, balance adjustments, imports, run batch, rebuilds, MDR recalculation, status recompute | ❌ | ✅ | ✅ |
| Anything `finance` cannot do | — | — | **Nothing (M6)** |

There is no generic "Admin" role. The roles are `support`, `finance` and `super_admin` (`apps/admin/src/types.ts:23`).

### 6.3 Isolation and exposure

| Check | Result | Evidence |
|---|---|---|
| Path-merchant ownership | ✅ `assertOwnMerchant` / `assertRefundRequestScope` compare the session merchant to the path | `routes/paymentLinks.ts:52-56` |
| Cross-merchant transaction access | ✅ Scoped `WHERE id AND merchant_id`; a foreign id answers 404, not 403 | `initiateMerchantRefund.ts:66` |
| Report scope IDOR | ✅ Fixed (#76) | `reporting/scope.ts` |
| Impersonation writes | ✅ Writer-actor guard blocks money movement | `requireMerchantWriterActor` |
| Disabled admin grants | ✅ #13 fixed. Grants end and expire (verified: 3 QA grants each ended within seconds). | `admin_impersonation_grants` |
| Secrets | ✅ API key raw value shown once; webhook secret AES-256-GCM at rest | `0021`, `secretCrypto.ts` |
| Public checkout | ✅ No auth calls; expiry judged on the server clock (FP-187); per-token advisory lock | `pay.ts:109-112` |
| Error leakage | ✅ 500s return `{error:"internal_error"}` only; details stay in server logs | `errorHandler.ts:35` |
| Not verified | No live penetration testing; findings come from code reading and the earlier UI regression runs | — |

---

## 7. Product completeness

### 7.1 Backend features with no UI at all

Verified by searching both frontends for each API path:

| Capability | API exists | UI |
|---|---|---|
| Merchant signup | `POST /v1/merchants` | None |
| Business profile view and edit | `/:merchantId/business-profile` | None |
| KYC document upload and download | `/:merchantId/kyc/documents` | None |
| Merchant API keys | `/:merchantId/api-keys` (owner) | None in the dashboard |
| Transaction report, saved filters, export summary | `/v1/reporting/*` | None |
| Settlement summary | `/v1/settlement/summary` | None |
| Recent ledger activity | `/v1/analytics/recent-ledger-activity` | None |
| Webhook delivery archive and restore | admin archive routes | None |
| Webhook "send test event" | `webhooks/testSend.ts` | None |

### 7.2 Missing for a convincing Bahraini fintech product

- **Merchant controls:** suspend or reinstate, and refund hold (columns exist, no writers: H2, M5).
- **Disputes:** no chargeback or dispute workflow, although `status = 'chargeback'` exists in `transactions`.
- **Payouts:** no settlement bank account (IBAN) and no payout schedule visible to merchants.
- **Localisation:** no Arabic/RTL interface; no VAT handling (Bahrain VAT is 10%); no BenefitPay or local debit method; the settlement calendar isn't visible to merchants (the Bahrain weekend is Friday–Saturday).
- **Customer receipts:** no receipt email or download for the payer after checkout.
- **Team management:** no way for a merchant owner to invite or manage finance and support users (an `inviteCode.ts` module exists but isn't routed).

The feature recommendations are in **`FEATURE_RECOMMENDATIONS.md`**.

---

## 8. Medium and Low findings in detail

- **M1 Webhooks:** see §4.2.
- **M2 Refund reason:** see §4.3. The UI drawer posts `{ transactionId, amountFils? }` only (`apps/web/src/pages/transactions/RefundDrawer.tsx`).
- **M3 500 on non-integer amounts:** `toFils` throws `RangeError`, which isn't an `AppError` (`errorHandler.ts:35`). Fix: validate in the route, as `routes/refunds.ts:62` does.
- **M4 Wrong "current negotiated rate" in admin:** `fees/currentFeeScheduleDisplay.ts:43` uses `ORDER BY created_at DESC` with no `effective_from <= now()`. A back-dated correction entered later displays as current (BUG #46; reverted in `ba163fe`).
- **M5 Refund hold:** `merchants.refunds_enabled` is checked (`initiateMerchantRefund.ts:44-53`), but nothing writes it. Migration `0052` says `NULL` means "no hold", then a trailing comment says "`NULL` is treated as disabled until support explicitly enables refunds". The code treats `NULL` as enabled. **PO** must pick one rule; then add an admin toggle.
- **M6 Admin roles:** impersonation is open to `support` by design according to the UI code, but `CLAUDE.md` claims it is `super_admin`-gated. `super_admin` is functionally identical to `finance`. **PO:** decide what `super_admin` uniquely owns (admin user management, threshold changes, merchant suspension).
- **M7 Payment links:** see §4.1.
- **M8 Merchant data:** see §4.6.
- **M9 March close script:** `scripts/reconcile_march.ts:29-33` uses `Date.UTC` month bounds, contradicting ADR-0007 (Bahrain month). Regression #23, committed.
- **M10 Volume counter:** an `INTEGER` column clamped at 2,147,483,647 fils (≈ 2.1M BD). The volume tier is affected once lifetime volume passes the cap. Needs the DBA-approved migration.
- **L1** `paymentLinks/status.ts:37-40`: a stale `reserved` row returns `active` without checking `expires_at`. Pay still refuses it (410), but the checkout shows a payable form first.
- **L2** `pay.ts:34-38` `expiryReferenceTime` is unused; `routes/paymentLinks.ts:35-37` still documents `submittedAt` as honoured for API keys. The server clock is what is actually used.
- **L3** `webhooks/dispatcher.ts:59`: a test-only branch in production code (#58).
- **L4** Docs drift; see §0.
- **L5** `apps/web/src/pages/payment-links/PaymentLinkDetailPage.tsx` scans the first 100 links, because there is no merchant `GET …/payment-links/:id`. A one-row endpoint is the real fix (the code says so).

---

## 9. QA test data left by the UI review runs (2026-10-30)

Identified with read-only queries. **Nothing has been deleted or changed.**

### 9.1 Records created by the QA runs

| Table | Records | Identification |
|---|---|---|
| `payment_links` | **6** links with reference `CHECKOUT-REVIEW` (12.750 BD each), plus **1** `UI-REVIEW-001` | Ids: `cf47bb10…` (UI-REVIEW-001, **canceled at 16:31Z, not by the QA runs**), `476aece8…`, `dbbee49d…`, `9b13bd10…` (paid), `8ced4bbc…`, `d6aa3929…`, `bf1e76cc…` (still active) |
| `transactions` | **3** captured, 12.750 BD each | `ce28d113-6079-4eef-a288-51986f40dd87`, `900336d9-1a0f-4614-881b-4db72a73f7ad`, `ba3403a7-f4df-41f6-8954-3e5e459b3e3a` |
| `transaction_events` | 6 (3 `authorized`, 3 `captured`, 38,250 fils) | By the transaction ids above |
| `ledger_entries` | 12 (4 legs × 3: clearing / payable 38,250; payable / fee revenue 861) | By the transaction ids above |
| `admin_impersonation_grants` | **3**, all `support@filspay.test` → Alpha Retail Co, all ended | Issued 16:43:51Z, 16:45:36Z, 17:27:31Z |
| `sessions`, `admin_sessions`, OTP challenges | Many short-lived login rows (owner@alpharetail.example, support@betadigital.example, and the three seeded admins) | Created by automated logins; they expire on their own |
| Refunds | None | Query on `refunds` by the transaction ids above returned 0 rows |
| Idempotency keys | Not queried. The pay flow writes keys prefixed `paylink:<link id>:` (`pay.ts:144,172`), so rows for these links are expected. | Check before any cleanup |

No transaction rows carry the `CHECKOUT-REVIEW` reference other than the 3 above, so the declined test-card attempts (PAN ending 0002) left no transaction rows with that reference.

### 9.2 Activity that was **not** created by the QA runs

The database also shows admin activity today that the QA runs did not perform, so it must not be swept up in any cleanup:

- 2 `balance_adjustment` (Coral Bay Traders at 13:29Z; Alpha Retail Co at 16:27Z)
- 7 `credit_request_created` and 2 `credit_request_approved`
- 1 impersonation grant by `superadmin@filspay.test` at 16:33Z
- the cancellation of `UI-REVIEW-001`
- `owner@coralbaytraders.example` sessions

### 9.3 Cleanup: approval required

The safest cleanup that keeps the books balanced is **not** to delete rows. Instead:

1. Cancel the 3 still-active `CHECKOUT-REVIEW` links through the normal cancel endpoint.
2. Leave the 3 captured transactions as they are (they will settle like any capture), **or** refund them through the normal refund flow, which journals reversing legs.

Deleting ledger rows would unbalance `merchant_payable`. Nothing will be done without explicit approval.

---

## 10. Appendix: reproduction

- **C1 and H1:** a `tsx` probe imported `parseAdjustmentAmountFils`, `parseBhdToFils` and `applyRateFils` from the repository and printed the tables in §3. The probe file was deleted afterwards.
- **Permission matrix:** generated from every `app.<method>(…, { preHandler })` in `apps/api/src/routes/*.ts`.
- **Regression check:** `git log -1 -- <file>` shows `ba163fe` for `adjustmentCsvParsing.ts`, `discountAdjustment.ts`, `currentFeeScheduleDisplay.ts`, `scripts/reconcile_march.ts` and `apps/reporting/package.json`.
- **§9 data:** `SELECT`-only queries against `127.0.0.1:5432/filspay` (local docker stack).
