import { useState } from "react";
import { request } from "../../api/client.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { bhd } from "../../format.js";
import type { TransactionDto } from "../../types.js";

interface RefundResponse {
  id: string;
  transactionId: string;
  amountFils: number;
  feeReversedFils: number;
  status: string;
  transactionStatus: string;
  refundedTotalFils: number;
  occurredAt: string;
}

interface RefundDrawerProps {
  txn: TransactionDto;
  onRefunded: () => Promise<void>;
}

/** FP-212. Posts to `POST /v1/merchants/:merchantId/refunds`. */
export function RefundDrawer({ txn, onRefunded }: RefundDrawerProps) {
  const { me } = useDashboardAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per refund the user sets out to make, not per click: a retry
  // after a network error then replays the same refund instead of issuing a
  // second one. A fresh key once a refund lands (or the drawer reopens).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const merchantId = me?.merchant.id;
  const remainingFils = txn.capturedFils - txn.refundedFils;
  const refundable =
    (txn.status === "captured" || txn.status === "partially_captured" || txn.status === "partially_refunded") &&
    remainingFils > 0;

  function openDrawer(): void {
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
    setOpen(true);
  }

  async function handleRefund(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!merchantId) return;
    if (!window.confirm("Refund this transaction? The money goes back to the cardholder and cannot be recalled.")) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const trimmed = amount.trim();
      // Left blank, amountFils is omitted entirely and the API refunds
      // everything still refundable — its own documented default, same
      // affordance the capture form has.
      const body = trimmed === "" ? { transactionId: txn.id } : { transactionId: txn.id, amountFils: Number(trimmed) };

      await request<RefundResponse>(`/v1/merchants/${encodeURIComponent(merchantId)}/refunds`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      });

      setOpen(false);
      setAmount("");
      setIdempotencyKey(crypto.randomUUID());
      // Refetch rather than patch: the refund wrote a new transaction_events
      // row server-side, so the timeline is stale, not merely shorter.
      await onRefunded();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!refundable) return null;

  return (
    <RequireRole allow={["owner", "finance"]}>
      <div className="dash-actions">
        {error ? <p className="dash-error">{error}</p> : null}
        {open ? (
          <form className="dash-form dash-form-inline" onSubmit={(e) => void handleRefund(e)}>
            <label>
              Amount in fils (blank refunds everything still refundable)
              <input
                type="number"
                min={1}
                step={1}
                max={remainingFils}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <p className="dash-muted">
              Captured: {bhd(txn.capturedFils)} · Already refunded: {bhd(txn.refundedFils)} · Refundable:{" "}
              {bhd(remainingFils)}
            </p>
            <button type="submit" className="dash-button" disabled={submitting}>
              {submitting ? "Refunding..." : "Refund"}
            </button>
            <button type="button" className="dash-button" disabled={submitting} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="dash-button" onClick={openDrawer}>
            Refund
          </button>
        )}
      </div>
    </RequireRole>
  );
}
