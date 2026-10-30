import { useEffect, useRef, useState } from "react";
import { request } from "../../api/client.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { IconAlert, IconClose, IconRefund } from "../../components/icons.js";
import { ErrorMessage, Money } from "../../components/ui.js";
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

  /** Focus handling only: the amount field takes focus when the drawer
   *  opens, and focus goes back to the Refund button when it closes. */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      amountRef.current?.focus();
    } else if (wasOpen.current) {
      triggerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  function closeDrawer(): void {
    setOpen(false);
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

  // Display only: what the submit will ask for. Blank means "everything still
  // refundable", the API's own default, shown here with the same remaining
  // figure the summary above it already displays.
  const trimmedAmount = amount.trim();
  const typedFils = Number(trimmedAmount);
  const previewFils =
    trimmedAmount === "" ? remainingFils : Number.isInteger(typedFils) && typedFils > 0 ? typedFils : null;

  return (
    <RequireRole allow={["owner", "finance"]}>
      <button type="button" className="dash-button" onClick={openDrawer} ref={triggerRef}>
        <IconRefund />
        Refund
      </button>
      {open ? (
        <>
          <div
            className="dash-drawer-overlay"
            onClick={() => {
              if (!submitting) closeDrawer();
            }}
          />
          <aside
            className="dash-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-drawer-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !submitting) closeDrawer();
            }}
          >
            <form className="dash-drawer-form" onSubmit={(e) => void handleRefund(e)}>
              <div className="dash-drawer-header">
                <div>
                  <h2 id="refund-drawer-title">Refund payment</h2>
                  <p className="dash-muted">{txn.reference ? `Reference ${txn.reference}` : "No reference"}</p>
                </div>
                <button
                  type="button"
                  className="dash-icon-button"
                  aria-label="Close"
                  disabled={submitting}
                  onClick={closeDrawer}
                >
                  <IconClose />
                </button>
              </div>

              <div className="dash-drawer-body">
                <dl className="dash-summary">
                  <div className="dash-summary-row">
                    <dt>Captured</dt>
                    <dd>
                      <Money fils={txn.capturedFils} />
                    </dd>
                  </div>
                  <div className="dash-summary-row">
                    <dt>Already refunded</dt>
                    <dd>
                      <Money fils={txn.refundedFils} />
                    </dd>
                  </div>
                  <div className="dash-summary-row is-total">
                    <dt>Refundable</dt>
                    <dd>
                      <Money fils={remainingFils} />
                    </dd>
                  </div>
                </dl>

                <label className="dash-field">
                  Amount in fils
                  <span className="dash-input-affix">
                    <input
                      ref={amountRef}
                      type="number"
                      min={1}
                      step={1}
                      max={remainingFils}
                      value={amount}
                      placeholder={String(remainingFils)}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-describedby="refund-amount-hint"
                    />
                    <span className="dash-input-suffix">fils</span>
                  </span>
                  <span className="dash-field-hint" id="refund-amount-hint">
                    Leave blank to refund everything still refundable. 1000 fils = 1.000 BHD.
                  </span>
                </label>

                {previewFils !== null ? (
                  <div className="dash-preview-amount" aria-live="polite">
                    <span className="dash-hero-label">
                      {trimmedAmount === "" ? "Full refundable amount" : "You are refunding"}
                    </span>
                    <Money fils={previewFils} size="lg" />
                  </div>
                ) : null}

                <p className="dash-info">
                  <IconAlert />
                  <span>The money goes back to the cardholder and cannot be recalled.</span>
                </p>

                {error ? <ErrorMessage>{error}</ErrorMessage> : null}
              </div>

              <div className="dash-drawer-footer">
                <button
                  type="submit"
                  className="dash-button dash-button-danger-solid dash-button-block"
                  disabled={submitting}
                >
                  {submitting ? "Refunding..." : "Refund"}
                </button>
                <button
                  type="button"
                  className="dash-button dash-button-block"
                  disabled={submitting}
                  onClick={closeDrawer}
                >
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </>
      ) : null}
    </RequireRole>
  );
}
