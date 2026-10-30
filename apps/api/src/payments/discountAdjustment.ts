import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { applyRateFils, compareFils, parseBhdToFils, subtractFils, toFils } from "@filspay/money";
import { withTransaction } from "../db/withTransaction.js";
import { BadRequestError } from "../lib/errors.js";


/**
 * Parses a promotional discount amount (BD string from the merchant
 * pricing dashboard) into fils for the ledger adjustment.
 */
export function parsePromotionalDiscountFils(raw: string): number {
  // BD has three decimals: parseFloat(raw) * 100 read "4.75" as 475 fils,
  // a tenth of the real value, and went through a float on the way.
  let parsed: number;
  try {
    parsed = parseBhdToFils(raw);
  } catch {
    throw new BadRequestError("invalid_discount", `could not parse discount amount "${raw}"`);
  }
  if (parsed < 0) {
    throw new BadRequestError("invalid_discount", `could not parse discount amount "${raw}"`);
  }
  return parsed;
}

/**
 * Applies a merchant's negotiated processing discount against the MDR fee
 * capture.ts already charged. The discount reduces the amount the MDR is
 * charged on (ARCHITECTURE.md, discounted_fee.go), not the fee after it is
 * calculated. capture.ts's own response doesn't carry the
 * fee it just charged, so this reads it back from the transaction_events
 * row capture.ts already wrote (its `metadata.feeFils`), then reverses the
 * merchant's share via a same-day ledger adjustment.
 *
 * A merchant with negotiated_discount_bps = 0 (the default for anyone
 * without a negotiated rate) is a no-op: this
 * function reads the merchant row, sees a zero discount rate, and inserts
 * nothing.
 */
export async function applyCaptureDiscountAdjustment(
  pool: Pool,
  input: { merchantId: string; transactionId: string },
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const merchantRow = await client.query<{ negotiated_discount_bps: number; mdr_bps: number }>(
      `SELECT negotiated_discount_bps, mdr_bps FROM merchants WHERE id = $1`,
      [input.merchantId],
    );
    const discountBps = merchantRow.rows[0]?.negotiated_discount_bps ?? 0;
    if (discountBps === 0) return;

    // Exactly one adjustment per capture event. A replayed (idempotent)
    // capture returns its cached 200 without writing a new
    // transaction_events row, so the caller re-enters this path with
    // nothing new to adjust — reversing the same fee a second time would
    // credit the merchant twice for one capture. The row lock serializes
    // this count against a concurrent capture's own adjustment.
    await client.query(`SELECT id FROM transactions WHERE id = $1 FOR UPDATE`, [input.transactionId]);
    const countRow = await client.query<{ capture_events: string; adjustments: string }>(
      `SELECT (SELECT count(*) FROM transaction_events
                WHERE transaction_id = $1 AND event_type IN ('captured', 'partially_captured')) AS capture_events,
              (SELECT count(*) FROM ledger_entries
                WHERE transaction_id = $1 AND direction = 'credit'
                  AND description = 'capture: negotiated discount adjustment') AS adjustments`,
      [input.transactionId],
    );
    const counts = countRow.rows[0];
    if (counts && Number(counts.adjustments) >= Number(counts.capture_events)) return;

    const eventRow = await client.query<{ amount_fils: string; metadata: { feeFils?: number; mdrBps?: number } }>(
      `SELECT amount_fils, metadata FROM transaction_events
        WHERE transaction_id = $1 AND event_type IN ('captured', 'partially_captured')
        ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [input.transactionId],
    );
    const event = eventRow.rows[0];
    const feeBeforeDiscount = toFils(event?.metadata?.feeFils ?? 0);
    if (!event || feeBeforeDiscount <= 0) return;

    // ARCHITECTURE.md: "Discounts reduce the amount the MDR is charged on" —
    // the order settlement's ComputeSettlementFee (discounted_fee.go) uses.
    // Discounting the already-rounded fee instead rounds differently (602
    // fils at 275 bps / 12.5%: fee-first nets 15, amount-first nets 14), so
    // the ledger and the settlement batch disagreed by a fils on such
    // captures and reconciliation never tied. The adjustment is whatever
    // brings the charged fee down to the settlement figure.
    const amountFils = toFils(Number(event.amount_fils));
    const mdrBps = event.metadata?.mdrBps ?? merchantRow.rows[0]?.mdr_bps ?? 0;
    const settlementFee = applyRateFils(subtractFils(amountFils, applyRateFils(amountFils, discountBps)), mdrBps);
    if (compareFils(settlementFee, feeBeforeDiscount) >= 0) return;
    const discountFils = subtractFils(feeBeforeDiscount, settlementFee);

    const entryGroupId = randomUUID();
    await client.query(
      `INSERT INTO ledger_entries
         (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
       VALUES
         ($1, $2, $3, 'platform_fee_revenue', 'debit',  $4, now(), 'capture: negotiated discount adjustment'),
         ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: negotiated discount adjustment')`,
      [entryGroupId, input.merchantId, input.transactionId, discountFils],
    );
  });
}
