import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import "./CheckoutPage.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "loaded"; link: PaymentLinkPublicDto };

type PayState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PayPaymentLinkResponse }
  | { kind: "declined"; message: string; retryable: boolean }
  | { kind: "terminal"; message: string };

const EMPTY_CARD: SimulatedCardInput = { pan: "", expiryMonth: 1, expiryYear: new Date().getFullYear() + 1, cvv: "" };

export function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const [card, setCard] = useState<SimulatedCardInput>(EMPTY_CARD);
  const [brandHint, setBrandHint] = useState<string | null>(null);

  // FH: memory leak — this effect never aborts the fetch on unmount (React warning in console?)
  // theres a cancelled flag in the cleanup tho. warning must be from somewhere else — am
  useEffect(() => {
    if (!token) {
      setLoadState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    getPaymentLink(token)
      .then((link) => {
        if (!cancelled) setLoadState({ kind: "loaded", link });
      })
      .catch(() => {
        // Never distinguishes "malformed token" from "doesn't exist" —
        // matches the API's own non-disclosure choice.
        if (!cancelled) setLoadState({ kind: "not_found" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;

    // A fresh Idempotency-Key per explicit user action — every click,
    // including a "try again" after a decline, is a new attempt.
    const idempotencyKey = crypto.randomUUID();
    const submittedAt = new Date().toISOString();
    setPayState({ kind: "submitting" });

    try {
      const result = await payPaymentLink(token, { card, submittedAt }, idempotencyKey);
      setPayState({ kind: "success", result });
    } catch (err) {
      if (err instanceof ApiError) {
        const { statusCode, body } = err;
        if (statusCode === 402) {
          const stageLabel = body.stage === "capture" ? "Your payment could not be completed." : "Your card was declined.";
          setPayState({ kind: "declined", message: stageLabel, retryable: true });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "The acquirer is temporarily unavailable. Please try again.", retryable: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "This invoice has already been paid." });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "This payment link is no longer available." });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "A payment is already being processed for this link. Please try again shortly.", retryable: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "This payment link has expired." });
        } else {
          setPayState({ kind: "declined", message: body.message ?? "Something went wrong. Please try again.", retryable: true });
        }
      } else {
        setPayState({ kind: "declined", message: "Something went wrong. Please try again.", retryable: true });
      }
    }
  }

  if (loadState.kind === "loading") {
    return (
      <CheckoutFrame>
        <main className="checkout-page" aria-busy="true">
          <p className="checkout-visually-hidden" role="status">
            Loading...
          </p>
          <div className="checkout-skeleton" aria-hidden="true">
            <span className="is-short" />
            <span className="is-amount" />
            <span />
            <span className="is-field" />
            <span className="is-field" />
          </div>
        </main>
      </CheckoutFrame>
    );
  }

  if (loadState.kind === "not_found") {
    return (
      <StateScreen
        tone="neutral"
        icon={<IconLinkBroken />}
        title="Payment link not found"
        next="Check the link you were sent, or ask the business for a new one."
      >
        This payment link does not exist.
      </StateScreen>
    );
  }

  const { link } = loadState;

  if (payState.kind === "success") {
    return (
      <StateScreen
        tone="success"
        icon={<IconCheck />}
        title="Payment successful"
        amount={payState.result.amountFils}
        next="You can close this page. Keep the transaction ID for your records."
        details={
          <dl className="checkout-receipt">
            <div>
              <dt>Paid to</dt>
              <dd>{link.merchantDisplayName}</dd>
            </div>
            {link.reference ? (
              <div>
                <dt>Reference</dt>
                <dd>{link.reference}</dd>
              </div>
            ) : null}
            <div>
              <dt>Transaction ID</dt>
              <dd>
                <code>{payState.result.transactionId}</code>
              </dd>
            </div>
            <div>
              <dt>Paid at</dt>
              <dd>{formatPaidAt(payState.result.paidAt)}</dd>
            </div>
          </dl>
        }
      >
        Thank you — your payment has been received.
      </StateScreen>
    );
  }

  if (payState.kind === "terminal") {
    return (
      <StateScreen
        tone="neutral"
        icon={<IconBlocked />}
        title="Unable to pay"
        next="Contact the business if you have questions about this payment."
      >
        {payState.message}
      </StateScreen>
    );
  }

  if (link.status === "paid") {
    return (
      <StateScreen
        tone="success"
        icon={<IconCheck />}
        title="Already paid"
        merchant={link.merchantDisplayName}
        next="There's nothing more to do. Contact the business if you think this is wrong."
      >
        This invoice has already been paid.
      </StateScreen>
    );
  }
  if (link.status === "expired") {
    return (
      <StateScreen
        tone="warning"
        icon={<IconClock />}
        title="Link expired"
        merchant={link.merchantDisplayName}
        next="Ask the business to send you a new payment link."
      >
        This payment link has expired.
      </StateScreen>
    );
  }
  if (link.status === "canceled") {
    return (
      <StateScreen
        tone="neutral"
        icon={<IconBlocked />}
        title="No longer available"
        merchant={link.merchantDisplayName}
        next="The business canceled this link. Contact them if you still need to pay."
      >
        This payment link is no longer available.
      </StateScreen>
    );
  }
  if (link.status === "processing") {
    return (
      <StateScreen
        tone="warning"
        icon={<IconHourglass />}
        title="Payment processing"
        merchant={link.merchantDisplayName}
        action={
          <button type="button" className="checkout-action" onClick={() => window.location.reload()}>
            Refresh
          </button>
        }
      >
        A payment is being processed for this link — please wait a moment and refresh.
      </StateScreen>
    );
  }

  // link.status === 'active'
  const amount = formatBhd(toFils(link.amountFils));
  const submitting = payState.kind === "submitting";
  const dot = amount.indexOf(".");

  return (
    <CheckoutFrame>
      <main className="checkout-page">
        <div className="checkout-head">
          <span className="checkout-monogram" aria-hidden="true">
            {monogram(link.merchantDisplayName)}
          </span>
          <div className="checkout-head-text">
            <h1>{link.merchantDisplayName}</h1>
            <p className="checkout-head-sub">requests a payment</p>
          </div>
        </div>

        <div className="checkout-body">
          <div className="checkout-amount-block">
            <span className="checkout-label">Amount due</span>
            <p className="checkout-amount">
              {dot === -1 ? (
                amount
              ) : (
                <>
                  {amount.slice(0, dot)}
                  <span className="checkout-amount-fils">{amount.slice(dot)}</span>
                </>
              )}{" "}
              <span className="checkout-amount-currency">BHD</span>
            </p>
            {link.description ? <p className="checkout-description">{link.description}</p> : null}
            {link.reference ? (
              <p className="checkout-reference">
                Reference: <code>{link.reference}</code>
              </p>
            ) : null}
          </div>

          {payState.kind === "declined" ? (
            <div className="checkout-error" role="alert">
              <IconAlert />
              <span>
                <strong>{payState.message}</strong>
                {/try again/i.test(payState.message) ? null : "You can try again, or use a different card."}
              </span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="checkout-form">
            <label>
              Card number
              <span className="checkout-field checkout-field-pan">
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="1234 5678 9012 3456"
                  disabled={submitting}
                  value={card.pan}
                  onChange={(e) => {
                    const pan = e.target.value;
                    setCard({ ...card, pan });
                    const digits = pan.replace(/\D/g, "");
                    if (digits.length >= 4) {
                      void import("../../utils/helpers.js").then((m) => {
                        setBrandHint(m.formatCardBrandHint(digits));
                      });
                    } else {
                      setBrandHint(null);
                    }
                  }}
                />
                {brandHint && brandHint !== "unknown" ? (
                  <span className="checkout-brand-hint">{BRAND_LABELS[brandHint] ?? brandHint}</span>
                ) : null}
              </span>
            </label>
            <div className="checkout-form-row">
              <label>
                Expiry month
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={12}
                  required
                  placeholder="MM"
                  disabled={submitting}
                  value={card.expiryMonth}
                  onChange={(e) => setCard({ ...card, expiryMonth: Number(e.target.value) })}
                />
              </label>
              <label>
                Expiry year
                <input
                  type="number"
                  inputMode="numeric"
                  min={new Date().getFullYear()}
                  required
                  placeholder="YYYY"
                  disabled={submitting}
                  value={card.expiryYear}
                  onChange={(e) => setCard({ ...card, expiryYear: Number(e.target.value) })}
                />
              </label>
              <label>
                CVV
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="123"
                  disabled={submitting}
                  value={card.cvv}
                  onChange={(e) => setCard({ ...card, cvv: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" disabled={submitting} aria-live="polite">
              {submitting ? (
                <>
                  <span className="checkout-spinner" aria-hidden="true" />
                  Processing...
                </>
              ) : (
                <>
                  <IconLock />
                  {`Pay ${amount} BHD`}
                </>
              )}
            </button>
            <p className="checkout-trust">
              <IconLock />
              Card details are sent only to process this payment.
            </p>
          </form>
        </div>

        <p className="checkout-help">
          Test cards (simulated acquirer, no real charge): any other number approves; a PAN ending{" "}
          <code>0002</code> always declines (do not honor); ending <code>0119</code> always declines
          (insufficient funds); ending <code>0069</code> always errors.
        </p>
      </main>
    </CheckoutFrame>
  );
}

const BRAND_LABELS: Record<string, string> = {
  visa: "VISA",
  mastercard: "Mastercard",
  amex: "AMEX",
};

/** Up to two initials for the merchant monogram. Display only. */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "FP";
}

/** The API's ISO instant, shown in the payer's own locale. Falls back to the
 *  raw value rather than "Invalid Date". */
function formatPaidAt(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

/** Brand above, footer below — shared by every checkout state. */
function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="checkout-root">
      <div className="checkout-brand">
        <svg className="checkout-brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <circle cx="16" cy="16" r="15" fill="#762D3D" />
          <circle cx="16" cy="16" r="11.5" fill="none" stroke="#C49A45" strokeWidth="1.25" />
          <circle cx="16" cy="16" r="4.25" fill="#F8F5EF" />
        </svg>
        FilsPay
      </div>
      {children}
      <footer className="checkout-footer">
        <span className="checkout-footer-line">
          <IconLock />
          Checkout by FilsPay
        </span>
      </footer>
    </div>
  );
}

function StateScreen({
  tone,
  icon,
  title,
  children,
  merchant,
  amount,
  details,
  next,
  action,
}: {
  tone: "success" | "warning" | "neutral" | "danger";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  merchant?: string;
  amount?: number;
  details?: React.ReactNode;
  next?: string;
  action?: React.ReactNode;
}) {
  return (
    <CheckoutFrame>
      <main className={`checkout-page checkout-state checkout-state-${tone}`}>
        <span className="checkout-state-icon">{icon}</span>
        <h1>{title}</h1>
        {amount !== undefined ? <p className="checkout-amount">{formatBhd(toFils(amount))} BHD</p> : null}
        <p>{children}</p>
        {merchant ? <p className="checkout-head-sub">{merchant}</p> : null}
        {details}
        {next ? <p className="checkout-next">{next}</p> : null}
        {action}
      </main>
    </CheckoutFrame>
  );
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="checkout-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const IconLock = () => (
  <Icon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
);

const IconCheck = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

const IconAlert = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </Icon>
);

const IconClock = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

const IconHourglass = () => (
  <Icon>
    <path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9" />
  </Icon>
);

const IconBlocked = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </Icon>
);

const IconLinkBroken = () => (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    <path d="M4 4l3 3M20 20l-3-3" />
  </Icon>
);
