# FilsPay — Feature Recommendations

**Date:** 2026-10-30 · Companion to `FILSPAY_BUSINESS_AUDIT.md`.

These are recommendations, not commitments. Every item needs product-owner approval before it's built. Items are ordered by **demo value per unit of effort**, favouring features where the API, schema or a module **already exists** and only needs wiring.

**Complexity:**

| Size | Meaning |
|---|---|
| S | Up to 1 day, frontend only or a single small endpoint |
| M | 2–3 days, includes a migration or a new endpoint |
| L | A week or more, new workflow |

Example data uses the seeded fictional Bahraini merchants (Coral Bay Traders, Seef Kiosk Partners, Palm Grove Retail, Gamma Hospitality Group) and realistic BHD amounts.

---

## Quick view

| # | Feature | Reuses | Complexity | Demo value |
|---|---|---|---|---|
| 1 | Merchant onboarding wizard (signup, business profile, KYC upload) | Signup, profile and KYC APIs | M | ★★★★★ |
| 2 | API keys and webhook "send test event" in the dashboard | API-key routes, `webhooks/testSend.ts` | S | ★★★★ |
| 3 | Reports and CSV export page | `/v1/reporting/*`, saved filters, export | S–M | ★★★★ |
| 4 | Payment links 2.0: BD input, QR code, WhatsApp share, required reference | Payment-link create, checkout | S–M | ★★★★★ |
| 5 | Webhook event subscriptions and `payment_link.paid` | Dispatcher, outbox | M | ★★★ |
| 6 | Refund reason codes and a refund timeline | Refund route, `refunds.reason` | S | ★★★ |
| 7 | Merchant risk controls: suspend, reinstate, refund hold | `merchants.status`, `refunds_enabled`, admin audit log | M | ★★★★ |
| 8 | Maker-checker for balance adjustments | `credit_requests` pattern | M | ★★★ |
| 9 | Settlement bank account (IBAN) and payout calendar | Settlement batches, payout disbursements | M | ★★★★ |
| 10 | VAT-aware invoices (Bahrain 10%) | Payment links, checkout | M | ★★★★ |
| 11 | Arabic / RTL interface | Design tokens, all pages | L | ★★★★★ |
| 12 | BenefitPay / local debit option in checkout (simulated) | Acquirer simulator, checkout | L | ★★★★★ |
| 13 | Customer receipts | Transactions, checkout success screen | S–M | ★★★ |
| 14 | Disputes and chargebacks workflow | `transactions.status = 'chargeback'` | L | ★★★ |

---

## 1. Merchant onboarding wizard

- **Problem solved:** a new merchant can't onboard themselves. `POST /v1/merchants` (signup), the business profile and the KYC upload API all exist, but no screen uses them. Today, merchants exist only through the seed data.
- **Proposed functionality:** a three-step public flow covering business details, owner account and documents, followed by a status page ("Submitted → Under review → Approved"). Bahrain-aware fields:
  - CR number (Sijilat format to confirm with the PO)
  - `+973` phone
  - structured address (Building / Road / Block / Area)
- **User workflow:**
  1. The owner of "Seef Kiosk Partners" opens `/signup` and enters legal name, CR number and business type (`llc`).
  2. They create the owner login.
  3. They upload their CR certificate and ID.
  4. They land on "Under review".
  5. Finance approves the KYC in the admin console (which already exists).
  6. The merchant's dashboard unlocks payments.
- **Technical implementation:**
  - New `apps/web` routes `/signup` and `/dashboard/onboarding` calling the existing endpoints.
  - Add format validation server-side (audit §4.6).
  - The KYC upload uses the existing multipart route and file-signature check.
- **Complexity:** M.
- **Hackathon demonstration value:** ★★★★★. It shows the full lifecycle (merchant applies → admin reviews KYC → merchant takes first payment) across both apps.

## 2. API keys and "send test event" in the dashboard

- **Problem solved:** developers can't get credentials or test their webhook receiver without an admin. Owner-only API-key routes and `webhooks/testSend.ts` already exist without UI.
- **Proposed functionality:**
  - **Developers** page: list keys (prefix, label, last used), create a key (shown once, copy-to-clipboard), revoke with a confirmation.
  - Webhook endpoint detail gets a **Send test event** button showing the receiver's status code.
- **User workflow:** the owner of Palm Grove Retail creates a "WooCommerce" key, pastes it into their store plugin, registers `https://palmgrove.example/filspay/hooks`, presses **Send test event**, and sees `200 OK`.
- **Technical implementation:**
  - Frontend only for keys.
  - For test-send, route the existing module behind `requireMerchantRole("owner","finance")`.
  - Add the private-address check first (audit M1), because test-send returns the receiver's body.
- **Complexity:** S.
- **Hackathon demonstration value:** ★★★★. A "developer-ready platform" moment with very little code.

## 3. Reports and CSV export

- **Problem solved:** finance staff at merchants need month-end exports. The reporting API (`/v1/reporting/transactions`, saved filters, export summary) and `/v1/transactions/export` exist, but only the export is reachable, and only by URL.
- **Proposed functionality:** a **Reports** page with the transaction report, filters (date, status, reference), saved filters ("October card sales"), an export summary card (rows and totals before download) and a CSV download.
- **User workflow:** the finance user at Gamma Hospitality Group picks 1–31 October, saves the filter, checks the summary ("1,284 transactions, 48,920.375 BD") and downloads the CSV for their accountant.
- **Technical implementation:**
  - Frontend on existing endpoints.
  - Reuse the dashboard table and filter primitives.
  - Respect the existing server-side date bounding (BUG #47).
- **Complexity:** S–M.
- **Hackathon demonstration value:** ★★★★.

## 4. Payment links 2.0

- **Problem solved:**
  - Merchants type amounts in **fils** (`37500` for 37.500 BD), which invites 10× errors.
  - The reference is optional and not unique, so links can't be reconciled to invoices (audit §4.1).
  - Bahraini small businesses share links mainly over WhatsApp and in person.
- **Proposed functionality:**
  - BD amount input (`parseBhdToFils`), with the fils value shown as a hint.
  - Required reference, unique per merchant (pending PO approval).
  - **QR code** on the link detail page, for counter or table payments.
  - **Share via WhatsApp** button with a pre-filled message: "Coral Bay Traders: invoice INV-2026-0142, 37.500 BD — pay here: …".
  - Optional "send receipt to" field.
- **User workflow:** at a Manama café, staff create a 4.750 BD link for table 12; the customer scans the QR code and pays on their phone; the dashboard shows it paid seconds later.
- **Technical implementation:**
  - QR generated client-side (small library or hand-rolled SVG encoder).
  - WhatsApp `https://wa.me/?text=` deep link.
  - Uniqueness via a partial unique index `(merchant_id, reference) WHERE status <> 'canceled'`, plus a 409 path.
- **Complexity:** S–M.
- **Hackathon demonstration value:** ★★★★★. The most relatable live demo: scan, pay, watch the dashboard update.

## 5. Webhook event subscriptions and `payment_link.paid`

- **Problem solved:**
  - Every endpoint receives every event, with no choice.
  - E-commerce integrations need "this invoice was paid", but only `transaction.captured`, `transaction.voided` and `settlement.paid` exist (`dispatcher.ts:28`).
- **Proposed functionality:**
  - Event checkboxes per endpoint (default: all).
  - New `payment_link.paid` event carrying `reference`, so an order system can match its own order id.
  - `refund.succeeded` is deferred to v1.9 by repository instruction (#72) and needs PO approval.
- **User workflow:** the merchant subscribes their ERP endpoint to `payment_link.paid` only; when the customer pays, the ERP receives `{ reference: "INV-2026-0142", amountFils: 37500, transactionId }` and marks the invoice paid.
- **Technical implementation:**
  - Migration adding `event_types TEXT[]` with a default of all.
  - Filter in the dispatcher.
  - Emit an outbox event in `pay.ts` after finalize.
- **Complexity:** M.
- **Hackathon demonstration value:** ★★★.

## 6. Refund reason codes and refund timeline

- **Problem solved:** every refund is stored as `reason = 'unspecified'` because the UI never sends a reason (audit M2). Chargeback defence and reporting need reasons.
- **Proposed functionality:**
  - A reason select in the refund drawer: requested by customer, duplicate, fraudulent, product not delivered, other + note.
  - Refunds shown on the transaction timeline with their reason.
- **User workflow:** a finance user refunds 12.000 BD of a 45.500 BD order as "Product not delivered — 2 items out of stock"; the timeline shows the partial refund and the reason.
- **Technical implementation:**
  - Enum validation in `routes/refunds.ts`.
  - Validate the existing `NOT VALID` constraint.
  - Add a drawer field.
- **Complexity:** S.
- **Hackathon demonstration value:** ★★★.

## 7. Merchant risk controls: suspend, reinstate, refund hold

- **Problem solved:** `merchants.status` and `merchants.refunds_enabled` exist but nothing enforces or sets them, so a merchant under fraud review can't be stopped (audit H2, M5).
- **Proposed functionality:**
  - Admin buttons **Suspend payments**, **Reinstate** and **Hold refunds**, each requiring a reason and written to the admin audit log.
  - Enforcement on authorize, capture, link creation and pay.
  - The merchant dashboard shows a clear banner when payments are suspended.
- **User workflow:**
  1. Risk spots a chargeback spike at a merchant.
  2. A finance admin suspends payments with the reason "Chargeback ratio 3.1% — review".
  3. The merchant's checkout links show "temporarily unavailable".
  4. After review, the admin reinstates the merchant.
- **Technical implementation:**
  - Admin route that updates `status` and `refunds_enabled`, plus an audit row in the same transaction (the existing KYC-review pattern).
  - Checks in `authorize.ts` and `pay.ts`.
  - **PO** to decide whether refunds remain allowed while suspended, and to settle the `NULL` semantics of `refunds_enabled`.
- **Complexity:** M.
- **Hackathon demonstration value:** ★★★★. A visible "compliance in action" story.

## 8. Maker-checker for balance adjustments

- **Problem solved:** one finance operator can move any amount with a balance adjustment, while credits above 50.000 BD need two people (audit H3).
- **Proposed functionality:**
  - Adjustments above a threshold become requests in an **Approvals** queue.
  - The approver must be a different admin **user id**, not a different display name.
- **User workflow:** an adjustment of −120.000 BD for Coral Bay Traders goes to "Awaiting approval"; a second finance admin reviews the reason and approves it; the ledger posts it.
- **Technical implementation:**
  - Reuse `credit_requests` and the Credits queue UI (generalise it to "money requests").
  - Change `assertDistinctApprover` to compare `admin_user_id`. That change is retained by instruction today, so it needs security and PO sign-off.
- **Complexity:** M.
- **Hackathon demonstration value:** ★★★.

## 9. Settlement bank account (IBAN) and payout calendar

- **Problem solved:** merchants can see batches but not **where** or **when** money goes. There's no bank-account field, and the Bahrain weekend (Friday–Saturday) and holidays aren't visible.
- **Proposed functionality:**
  - Bank details with Bahraini IBAN validation: 22 characters, `BH` + 2 check digits + 4-letter bank code + 14 account digits, mod-97 checked.
  - A **Payout calendar** showing upcoming batch dates and expected net payout per day.
- **User workflow:** the owner adds `BH67BMAG00001299123456`; the calendar shows "Sun 2 Nov: est. 1,820.450 BD (batch for Thu 30 Oct)".
- **Technical implementation:**
  - Migration for `merchant_bank_accounts`, with owner-only edit and a change audit.
  - The estimate reuses `settlement/payout_estimate.go`.
- **Complexity:** M.
- **Hackathon demonstration value:** ★★★★.

## 10. VAT-aware invoices (Bahrain 10%)

- **Problem solved:** Bahraini VAT-registered merchants must show VAT on invoices. Payment links carry only a single amount.
- **Proposed functionality:**
  - Optional VAT on link creation: net + 10% VAT = total.
  - Merchant VAT number on the business profile.
  - The checkout and receipt show the breakdown.
- **User workflow:** the merchant creates a link for 50.000 BD net; the checkout shows "Subtotal 50.000 · VAT 10% 5.000 · Total 55.000 BD"; the receipt shows their VAT number.
- **Technical implementation:**
  - Store `vat_rate_bps` and `net_amount_fils` on `payment_links` (the total stays `amount_fils`, so payments and settlement are unchanged).
  - Compute VAT with `applyRateFils`.
  - **PO** to confirm VAT handling with an accountant.
- **Complexity:** M.
- **Hackathon demonstration value:** ★★★★.

## 11. Arabic / RTL interface

- **Problem solved:** Arabic is Bahrain's official language. The interface is English-only, which weakens the "Bahraini identity" the brand aims for.
- **Proposed functionality:**
  - A language switch: English / العربية.
  - Full right-to-left layout.
  - Arabic copy for the checkout first (customer-facing), then the dashboard.
  - BHD shown as "١٢٫٧٥٠ د.ب", or Western digits, per a PO decision.
- **User workflow:** a customer opens a payment link and taps **العربية**; the whole checkout mirrors and reads naturally.
- **Technical implementation:**
  - `dir="rtl"` plus a string catalogue.
  - The design tokens and layouts need logical CSS properties; a few physical left/right values remain to convert.
  - Add an Arabic font pairing (e.g. IBM Plex Sans Arabic).
  - Start with the checkout (one page).
- **Complexity:** L (checkout alone: S–M).
- **Hackathon demonstration value:** ★★★★★.

## 12. BenefitPay / local debit option (simulated)

- **Problem solved:** most Bahraini consumers pay with local debit cards and BenefitPay; card-only checkout feels foreign.
- **Proposed functionality:** a second tab in the checkout, **BenefitPay**, driven by the existing **simulator** (no real integration): it shows a QR code or "open BenefitPay" step and then the same success screen.
- **User workflow:** a customer chooses BenefitPay, approves in a simulated wallet screen, and returns to the receipt.
- **Technical implementation:**
  - Extend `acquirer/simulator.ts` with a wallet method.
  - Reuse authorize/capture with `payment_method`.
  - Migration for `transactions.payment_method`.
  - **Clearly labelled as simulated.** A real integration needs a licensed acquirer.
- **Complexity:** L.
- **Hackathon demonstration value:** ★★★★★.

## 13. Customer receipts

- **Problem solved:** after paying, the customer only sees an on-screen success page. There's no email or downloadable receipt (`transactions/receipt.ts` exists but no route serves it).
- **Proposed functionality:** **Download receipt** on the checkout success screen, and an optional email field before paying; the receipt shows merchant, reference, amount, date and the last 4 card digits.
- **User workflow:** a customer pays 12.750 BD to Alpha Retail Co and downloads a PDF receipt for expense claims.
- **Technical implementation:**
  - A public route keyed by the payment-link token and transaction, returning only receipt fields.
  - Print-styled HTML instead of server-side PDF.
- **Complexity:** S–M.
- **Hackathon demonstration value:** ★★★.

## 14. Disputes and chargebacks workflow

- **Problem solved:** `transactions.status` allows `'chargeback'`, but there is no way to record, respond to or track a dispute.
- **Proposed functionality:** an admin records a chargeback (reason code, amount, deadline); the merchant sees it in a **Disputes** inbox, uploads evidence and responds; the outcome posts ledger entries.
- **User workflow:** a cardholder disputes 89.900 BD at Palm Grove Retail; the merchant uploads the delivery note before the deadline; an admin marks the dispute won.
- **Technical implementation:**
  - `disputes` table and ledger postings for the debit and its reversal.
  - Reuse the KYC upload pipeline for evidence.
  - Add webhook events.
- **Complexity:** L.
- **Hackathon demonstration value:** ★★★.

---

## Suggested hackathon sequence

1. **Fix the audit's Critical and High items first** (C1, H1, H2, H4-Void, H5). A demo that posts the wrong money undermines everything else.
2. **Demo spine:** #1 Onboarding → #4 Payment links 2.0 (QR / WhatsApp) → checkout → #3 Reports. This tells the story "a Bahraini café signs up, gets paid by QR, exports its month".
3. **Differentiators, if time allows:** #11 Arabic checkout, #10 VAT, #7 Risk controls.
