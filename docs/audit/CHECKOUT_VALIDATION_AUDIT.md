# FilsPay — Checkout Input Validation Audit (`/pay/:token`)

**Date:** 2026-10-30 · **Branch:** `redesign/ui-ux` · **Type:** read-only audit. **No code, schema or data was changed, and no payment requests were made.**

## Method

Evidence comes from three sources:

- **Code:** [`apps/web/src/pages/checkout/CheckoutPage.tsx`](../../apps/web/src/pages/checkout/CheckoutPage.tsx), [`apps/api/src/routes/paymentLinks.ts`](../../apps/api/src/routes/paymentLinks.ts), [`paymentLinks/pay.ts`](../../apps/api/src/paymentLinks/pay.ts), [`paymentLinks/read.ts`](../../apps/api/src/paymentLinks/read.ts), [`payments/authorize.ts`](../../apps/api/src/payments/authorize.ts), [`payments/idempotency.ts`](../../apps/api/src/payments/idempotency.ts), [`acquirer/simulator.ts`](../../apps/api/src/acquirer/simulator.ts), [`plugins/errorHandler.ts`](../../apps/api/src/plugins/errorHandler.ts).
- **Read-only probes:**
  - One `GET /v1/payment-links/:token` against a local test link.
  - Pure-function calls to `createAcquirerSimulator(...).authorize` and `hashRequest`, with no database and no HTTP.
- **Earlier runs:** the 2026-10-30 checkout browser suite (27/27).

Priorities follow the brief: **Critical** (unauthorised payments, wrong amounts, serious security), **High** (invalid submissions or business-rule bypass), **Medium** (inconsistent validation or poor UX), **Low** (minor).

---

## 1. Executive Summary

The checkout's **monetary core is sound**:

- The payer can't influence the amount, currency or reference; all three are read from the stored link.
- Link status and expiry are checked on the server clock.
- A per-link advisory lock prevents two concurrent payments.
- Every query is parameterised.
- No XSS sink exists.

The weaknesses are in **card-input validation and exposure on the public endpoints**:

1. The public link endpoint **leaks the merchant's live API-key hash and prefix** to anyone holding a link.
2. The server performs **no card validation**: an expired card (01/2001), month 13, PAN `"hello"` and an empty CVV are all **approved** and then captured.
3. A malformed card type crashes the request **after the link is reserved**. That locks the link for 60 seconds, repeatably and without authentication.
4. An **unsalted hash covering the PAN and CVV** is persisted in `idempotency_keys`.
5. There's **no rate limit** on public payment attempts, so a known link can be used for card testing.

There are **no customer fields** (name, email, phone, billing) and no payment-method choice: the checkout collects card data only.

**Findings by priority:** Critical **0** · High **5** · Medium **7** · Low **5** (17 total).

---

## 2. Checkout Input Inventory

Every value the payer or a direct API caller controls, found by tracing the page and both public endpoints:

| # | Input | Source | Sent to |
|---|---|---|---|
| 1 | Payment-link **token** | URL path `/pay/:token` | `GET /v1/payment-links/:token`, `POST …/:token/pay` |
| 2 | **Card number** (`card.pan`) | Text field | `POST …/pay` body |
| 3 | **Expiry month** (`card.expiryMonth`) | Number field (default `1`) | `POST …/pay` body |
| 4 | **Expiry year** (`card.expiryYear`) | Number field (default next year) | `POST …/pay` body |
| 5 | **CVV** (`card.cvv`) | Text field | `POST …/pay` body |
| 6 | **`submittedAt`** | Set by the page (`new Date().toISOString()`); any value via direct API | `POST …/pay` body (ignored server-side) |
| 7 | **`Idempotency-Key`** header | Set by the page (`crypto.randomUUID()` per click); any value via direct API | `POST …/pay` header |
| 8 | Any **extra body fields** (e.g. `amountFils`, `currency`, `reference`) | Direct API only | `POST …/pay` (ignored, see §6) |

**Not present in the implementation:** amount entry, customer name, email, phone, billing address, order number entry and payment-method selection. Amount, currency, reference and description come from the stored link and are display-only.

### Per-input results

| Input | Required? | Frontend validation | Backend validation | Current result | Recommendation |
|---|---|---|---|---|---|
| Token | Yes | None (taken from URL) | None on format. Parameterised lookup; 404 if unknown | Safe from injection. Any string, any length, reaches the DB and the advisory lock. | **Low:** reject anything not matching `^plink_[A-Za-z0-9_-]{22}$` with 404 before the DB or lock (backend) |
| Card number | Yes | `required`, `inputMode="numeric"`. No pattern, length or Luhn check. No `maxLength`. | **None.** Only `card` must be truthy (`routes/paymentLinks.ts:159`). Non-string → **500** after reservation. | `"hello"` and a 10,000-char PAN **approved**. Number type → `TypeError`. | **High:** server — string, digits only after stripping spaces, 12–19 digits, Luhn. Frontend — same rules inline, `maxLength`. |
| Expiry month | Yes | `type=number`, `min=1`, `max=12`, `required` | **None** | `13` **approved** | **High:** server — integer 1–12. Frontend — keep, plus an inline message. |
| Expiry year | Yes | `type=number`, `min=current year`, `required` | **None** | `2001` and `99999` **approved** | **High:** server — integer, card not expired (month and year ≥ the current Bahrain month), at most 20 years ahead. Frontend — a combined month/year check. |
| CVV | Yes | `required`, `inputMode="numeric"`. No pattern or length. | **None** | `"abc"` and `""` **approved** | **High:** server — 3 digits (4 for Amex). Frontend — `pattern`, `maxLength=4`. |
| `submittedAt` | No | Generated, not user-entered | Accepted and **ignored** (expiry uses the server clock, `pay.ts:109-112`) | Harmless; dead parameter | **Low:** stop sending it; remove the helper and the misleading route comment (both) |
| `Idempotency-Key` | Yes | Generated per click | Required (400 if missing). No length or format check. Scoped per link (`paylink:<linkId>:<key>`). | Correct scoping; unbounded | **Low:** require a UUID-like value ≤ 64 chars (backend) |
| Extra body fields | — | — | Ignored: only `card` and `submittedAt` are read | `amountFils`, `currency` and `reference` **can't** be tampered with | Keep. Optionally reject unknown fields for hygiene. |

---

## 3. Required vs Optional Fields

| Field | Should be | Today | Notes |
|---|---|---|---|
| Card number, expiry month, expiry year, CVV | **Required** | Required in HTML only; the server checks only that `card` exists | Server must enforce |
| Customer name | Not required | Absent | Not needed by the simulated acquirer. **PO decision:** cardholder name if a real acquirer requires it. |
| Email | **Optional (PO)** | Absent | Useful for a receipt (business audit, feature #13). Don't make it mandatory: it adds friction to a QR or WhatsApp payment. |
| Phone | Not required | Absent | Only if the PO wants SMS receipts (`+973` and 8 digits) |
| Billing address | Not required | Absent | Not used in Bahrain card-not-present flows on this platform |
| Amount, currency, reference | Not payer inputs | Display-only from the link | Correct |

---

## 4. Frontend Validation Findings

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| FE-1 | Medium | Card fields have **only `required`**: no PAN pattern, length or Luhn check, no CVV length, no combined month/year "not expired" check, no `maxLength` | `CheckoutPage.tsx` card inputs |
| FE-2 | Medium | **Errors are not shown next to the field as text.** Invalid fields get a red border (`:user-invalid`), but the message comes only from the browser's native bubble on submit. Screen readers get no persistent description. | `CheckoutPage.css` `:user-invalid`; no `aria-invalid` or `aria-describedby` on the card inputs |
| FE-3 | Low | Clearing the month or year field stores `0` (`Number("")`), so the box shows `0` until the user deletes it | `onChange … Number(e.target.value)` |
| FE-4 | Low | The page sends an unused `submittedAt` | `handleSubmit` |

**Already correct:**
- Values are preserved after a decline, so the payer can correct and retry without restarting.
- Inputs and the button are disabled while paying, preventing double submission.
- A fresh `Idempotency-Key` is generated per click.
- No `autocomplete="cc-*"`, so no browser card-saving prompt.
- The payer can't change the amount.
- All server messages are rendered as text (React escaping).

**Bypass:** every frontend rule is bypassed by calling `POST /v1/payment-links/:token/pay` directly. See §5.

---

## 5. Backend Validation Findings

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| BE-1 | **High** | **No card validation at all.** The route checks only `if (!card)`. The simulator approves anything except three magic PAN suffixes. Executed: expiry 01/2001, month 13, year 99999, PAN `"hello"`, CVV `"abc"`, CVV `""` and a 10,000-char PAN → **approved**. In the pay flow an approval is immediately **captured**. | `routes/paymentLinks.ts:157-161`; `acquirer/simulator.ts` `magicOutcomeForPan` / `rollOutcome` |
| BE-2 | **High** | **A malformed card locks the link.** `pan` as a number, or missing, throws `TypeError` inside the simulator. The pay flow has already claimed the link (`status = 'reserved'`), and the exception skips `releaseReservation`. The link stays reserved for 60s (`PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS`) and the public page shows "Payment processing". Repeating one unauthenticated request every 60s blocks a known link indefinitely, and each attempt returns 500. | Executed: `TypeError: pan.endsWith is not a function`; `pay.ts:117-133` (claim) → `:145` (authorize) with no try/finally; `config.ts:248` |
| BE-3 | Medium | **Unbounded field sizes.** PAN, CVV and `Idempotency-Key` have no length limits. The body limit is Fastify's default 1 MiB. | Executed: a 10,000-char PAN approved; no `bodyLimit` set |
| BE-4 | Low | The token is not format-checked before the DB lookup and the advisory lock | `pay.ts:67-72`, `read.ts` |
| BE-5 | Low | A stale `reserved` link past its expiry is reported publicly as `active` (pay then answers 410) | `paymentLinks/status.ts:37-40` |

**Already correct:**
- Status and expiry are enforced at claim time on the server clock (`pay.ts:112-133`).
- `paid` → 409, `canceled` → 409, expired → 410, a concurrent attempt → 409.
- The idempotency key is required.
- Every query is parameterised.

---

## 6. Payment and Monetary Validation

| Check | Result | Evidence |
|---|---|---|
| Amount positive | ✅ `CHECK (amount_fils > 0)`; validated at link creation | `0020_payment_links.sql` |
| Amount within configured limits | ⚠️ **No maximum exists** (Medium, MO-1). The checkout charges whatever the link holds. | `paymentLinks/create.ts` |
| BHD precision (3 decimals) and no floats | ✅ Integer fils from the DB; displayed with `formatBhd` (three decimals); no floating-point arithmetic | `CheckoutPage.tsx` |
| Frontend in BHD | ✅ Displays BHD. ⚠️ The API still returns `amountFils`; conversion happens in the browser with `formatBhd`, which is exact. The BHD API contract is pending (currency audit, U28). | Low (MO-3) |
| **Amount can't be manipulated** | ✅ The pay body has no amount; authorize uses `link.amountFils` from the claimed DB row; capture takes the full authorized amount | `pay.ts:135-178` |
| Currency and reference can't be manipulated | ✅ Fixed `BHD` by DB CHECK; the reference comes from the link row | `authorize.ts:96`; `pay.ts:149` |
| Amount sent to the processor matches the link | ✅ `amountFils: link.amountFils` (`pay.ts:147`) | — |
| Status and expiry verified before payment | ✅ Atomic conditional claim | `pay.ts:117-128` |
| **Duplicate payments** | ✅ Per-token advisory lock plus atomic claim plus a disabled button: one link can't be paid twice. ⚠️ **Capture-stage failure leaves an orphan authorization** (Medium, MO-2): when authorize succeeds and capture fails, only the reservation is released. The authorized transaction and its 7-day hold remain, and a retry authorizes again, so the payer briefly has **two holds for one invoice**. | `pay.ts:180-186`; `authorize.ts:115-119` (hold) |

---

## 7. Security Findings

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| SEC-1 | **High** | **The public endpoint exposes the merchant's live API-key hash and prefix.** `GET /v1/payment-links/:token` joins the newest unrevoked `api_keys` row and returns `merchantPublicKey` (prefix) and `merchantIntegrationId` (`key_hash`, the SHA-256 of the raw key). Verified read-only: a 16-char prefix and a 64-hex hash are returned for Alpha Retail Co. The hash can't be replayed as a key, because keys are verified as `sha256(rawKey)` and are high-entropy. But it publishes a credential-derived secret, identifies the live key, and contradicts the code's own invariants: the web type says "The server must never add API-key fields to this response", and the admin code says views "deliberately withhold `api_keys.key_hash`". The checkout doesn't use either field. | `paymentLinks/read.ts:30-40, 51-52`; `apiKeys/verify.ts:25-29` |
| SEC-2 | **High** | **Card data persisted as an unsalted hash.** `authorize` stores `sha256(canonicalJson({ amountFils, card: { pan, expiryMonth, expiryYear, cvv }, reference }))` in `idempotency_keys.request_hash`. PCI DSS prohibits keeping the CVV after authorization in any form. An unsalted hash of a low-entropy space (a known amount and reference, a 6-digit BIN, a 3-digit CVV) is guessable offline. Simulated cards only today, but the design isn't compliant. | `authorize.ts:51-55`; `idempotency.ts:65-67`, `:118-122` |
| SEC-3 | **High** | **No rate limiting or attempt cap** on the public `read` and `pay` endpoints. A declined attempt releases the link, so an attacker holding one link can test unlimited stolen card numbers against it (card testing). The token is also the only credential, and it comes from `Math.random()` (business audit H6). | No rate-limit plugin or dependency (`grep`); `pay.ts` `releaseReservation` on decline |
| SEC-4 | Medium | **Decline details exposed publicly.** The pay response passes through `declineReason` (`do_not_honor`, `insufficient_funds`, …) and `acquirerReference` to the unauthenticated caller. The page shows a generic message, but a script reads the reason, which helps card testing. | `authorize.ts:136-140` → `pay.ts:158-161` |
| SEC-5 | Medium | **Unbounded in-memory caches on a public path.** The simulator's `authorizeCache` and `captureCache` grow by one entry per attempt and are never evicted (an in-code comment acknowledges this). Combined with SEC-3, memory grows without limit. | `acquirer/simulator.ts` |
| — | ✅ | **SQL injection:** all queries parameterised. **XSS:** no `dangerouslySetInnerHTML` or `innerHTML`; merchant-controlled description and reference are rendered as text. **Error leakage:** unhandled errors return `{"error":"internal_error"}`; details stay in server logs, and Fastify doesn't log request bodies by default, so card data isn't logged. **Tampering:** amount, currency and reference are not taken from the request. | `errorHandler.ts:34-35` |

---

## 8. Missing or Incorrect Validations

| ID | Priority | Summary | Layer |
|---|---|---|---|
| SEC-1 | High | API-key hash and prefix returned by the public link endpoint | Backend |
| BE-1 | High | No server-side card validation (expired, month 13, garbage approved and captured) | Backend (+ frontend) |
| BE-2 | High | Malformed card → 500 after reservation, so the link is locked; repeatable denial of payment | Backend |
| SEC-2 | High | PAN and CVV persisted as an unsalted hash in `idempotency_keys` | Backend |
| SEC-3 | High | No rate limit or attempt cap on public pay/read (card testing) | Backend / infrastructure |
| FE-1 | Medium | Minimal client-side card checks | Frontend |
| FE-2 | Medium | No inline error text or `aria-invalid` on card fields | Frontend |
| BE-3 | Medium | Unbounded PAN, CVV and header lengths | Backend |
| MO-1 | Medium | No maximum payment amount | Backend (link creation) |
| MO-2 | Medium | Capture failure leaves an orphan authorization and hold; a retry double-authorizes | Backend |
| SEC-4 | Medium | Decline reason and acquirer reference exposed publicly | Backend |
| SEC-5 | Medium | Unbounded simulator caches | Backend |
| FE-3 | Low | Cleared number fields become `0` | Frontend |
| FE-4 / L | Low | Dead `submittedAt` parameter and misleading comment | Both |
| BE-4 | Low | No token format check | Backend |
| BE-5 | Low | Stale-reserved past expiry shown as active | Backend |
| MO-3 | Low | API returns fils; the BHD contract is pending (currency audit) | API |

Totals: 5 High, 7 Medium, 5 Low (17).

---

## 9. Recommended Fixes

| ID | What's wrong | Why it matters | What to change | Where |
|---|---|---|---|---|
| SEC-1 | The public DTO includes `merchantPublicKey` and `merchantIntegrationId` from `api_keys` | It publishes credential-derived data and fingerprints the live key for every merchant | Remove the `LEFT JOIN LATERAL … api_keys` and both fields from `read.ts`. Add a test asserting the public DTO's exact key set. | Backend |
| BE-1 | Any card shape is approved | Invalid or expired cards create real transactions and captures | Add `validateCardInput()` before claiming the link: `pan` is a string of 12–19 digits (spaces stripped) passing Luhn; `expiryMonth` an integer 1–12; `expiryYear` an integer, not expired relative to the current Asia/Bahrain month, ≤ now + 20; `cvv` `^\d{3,4}$`. Return 400 `invalid_card` with a field name. Keep the simulator's magic test suffixes working by publishing Luhn-valid test numbers that end in `0002`, `0119` and `0069` (`4000000000000002` already is). | Backend |
| BE-2 | An exception after the claim leaves the link reserved | An unauthenticated caller can block a merchant's payment link | Validate before the claim (BE-1). Also wrap authorize/capture in `try { … } catch { await releaseReservation(); throw }`. | Backend |
| SEC-2 | `request_hash` covers PAN and CVV | Retains card-derived data and the CVV after authorization | Exclude `cvv` from the hash input. Replace `pan` with the last 4 digits plus a server-side HMAC (keyed, not a plain hash) when same-card detection is needed. The idempotency key itself still guarantees replay safety. | Backend |
| SEC-3 | Unlimited attempts | Card testing; token guessing | Rate-limit `POST …/pay` per IP and per token (e.g. 5 attempts per 10 minutes per token, 30 per hour per IP), and stop accepting payments after N declines for a link (PO to set N). Use `@fastify/rate-limit` or an attempts table. | Backend |
| FE-1 / FE-2 | Weak client checks; no inline errors | Payers find mistakes only after a round trip, or not at all with assistive tech | Mirror the BE-1 rules in the page. Format the PAN in groups of 4. Show a message under each field with `aria-invalid` and `aria-describedby`. Validate on blur and on submit. Keep values on error. | Frontend |
| BE-3 | No length limits | Large payloads and memory pressure | Lengths in BE-1; `Idempotency-Key` ≤ 64; set `bodyLimit` (e.g. 16 KiB) on the pay route | Backend |
| MO-1 | No ceiling on link amounts | Typos and a compromised merchant session can charge any sum | **PO:** set a per-merchant maximum and enforce it at link creation (400) | Backend |
| MO-2 | Orphan authorization after a capture failure | Two holds on a customer's card for one invoice | On capture failure, void the just-authorized transaction (the flow already has `voidTransaction`) before releasing the reservation, or retry capture with the same key | Backend |
| SEC-4 | `declineReason` and `acquirerReference` returned publicly | A card-testing oracle | Return `{ error: "card_declined", stage }` only to public callers; keep details in the transaction record and merchant views | Backend |
| SEC-5 | Caches never evicted | Unbounded memory | Bounded LRU with a TTL (e.g. 10,000 entries, 1 hour) | Backend |
| FE-3 | Empty becomes `0` | Confusing input | Keep a string state for the inputs; convert on submit | Frontend |
| FE-4 / L | `submittedAt` unused | Misleading contract | Stop sending it; remove `expiryReferenceTime` and the route comment | Both |
| BE-4 | Any token string accepted | Needless DB and lock work on junk | Validate the token pattern → 404 | Backend |
| BE-5 | Stale-reserved past expiry shows active | The payer sees a form that then fails with 410 | Check `expires_at` in the `reserved` branch of `derivePublicStatus` | Backend |
| MO-3 | The API is in fils | Currency rule | Follow the currency audit plan (additive `amountBhd` string) | API |

---

## 10. Testing Recommendations

Add new test files (existing ones are locked), e.g. `apps/api/src/paymentLinks/payValidation.new.test.ts`, plus checkout browser checks.

**Card validation (backend: 400 `invalid_card`, link stays `active`):**

| Case | Card input | Expected |
|---|---|---|
| Valid Visa | `4111 1111 1111 1111`, 12/2027, `123` | Proceeds to authorize |
| Luhn failure | `4111111111111112` | 400 |
| Letters | `hello`, `4111-abcd-…` | 400 |
| Too short / long | 11 digits; 20 digits; 10,000 chars | 400 |
| Wrong type | `pan: 4111111111111111` (number), `pan` missing, `card: "x"` | 400, **not 500**; the link is still payable |
| Month | `0`, `13`, `1.5`, `"12"` | 400 |
| Expired | 09/2026 when today is Oct 2026 (Bahrain) | 400 `card_expired` |
| Year | `2001`, `99999` | 400 |
| CVV | `""`, `12`, `12345`, `abc`; Amex `1234` accepted | 400 / pass |
| Magic test cards | `4000000000000002` (decline), `…0119` (insufficient funds), `…0069` (error) | 402 / 402 / 502, unchanged |

**Payment integrity:**
- **Fixed amount:** POST `{ card, amountFils: 1 }` against a 12.750 BD link for "Seef Kiosk Partners" → the captured amount is still 12,750 fils.
- **Concurrency:** two simultaneous pays on one link → exactly one 200, the other 409 `payment_link_processing`, and one transaction.
- **Replay:** the same `Idempotency-Key` with the same body → identical response; the same key with a different card → 422.
- **Capture failure (MO-2):** force a capture `error` → no `authorized` transaction left behind; the link is `active`.
- **Expiry:** a link expiring in 1 second, paid after 2 → 410, even with `submittedAt` set in the past.
- **States:** `paid` → 409, `canceled` → 409, unknown token → 404, malformed token → 404 (BE-4).

**Security:**
- **SEC-1:** the public `GET` response keys equal exactly `token, amountFils, currency, merchantDisplayName, reference, description, status, expiresAt`.
- **SEC-2:** after an authorize, no `idempotency_keys` value can be recomputed from the CVV.
- **SEC-3:** the 6th pay attempt for one token within 10 minutes → 429.
- **XSS regression:** a link with description `<img src=x onerror=alert(1)>` renders as text.
- **Body size:** a 2 MiB body → 413.

**Frontend (browser suite):**
- An invalid PAN shows an inline message next to the field with `aria-invalid="true"`, and submission is blocked.
- After a 402 decline, every field keeps its value and focus moves to the error.
- Clearing the month field leaves it empty, not `0`.
- Mobile (390px): the error text is visible without horizontal scrolling.
