import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPaymentLink } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { Card, ErrorMessage, Money, PageHeader } from "../../components/ui.js";
import { dash, dateTime, localDateTimeToIso } from "../../format.js";

/**
 * `POST /v1/merchants/:merchantId/payment-links`, `owner`/`finance`
 * server-side.
 *
 * Amount is entered in fils — the platform's actual unit, and the same unit
 * the checkout page works in. No decimal-BHD input widget: a second
 * string-to-fils parser in the browser is exactly the kind of place a money
 * bug hides, and `parseBhdToFils` exists in @filspay/money for whenever a
 * phase genuinely wants that UI.
 *
 * The two client-side checks below mirror the server's own two real checks so
 * an obviously-bad value doesn't need a round trip. They are not the
 * validation: `400 invalid_amount` / `400 invalid_expiry` remain the real
 * answer and are rendered verbatim.
 */
export function PaymentLinkCreatePage() {
  const { me } = useDashboardAuth();
  const navigate = useNavigate();

  const [amountFils, setAmountFils] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // YA: amount typed as raw fils, no BD conversion. intentional for now
  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!me) return;
    setError(null);

    const amount = Number(amountFils);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("Amount must be a positive whole number of fils.");
      return;
    }
    const expiresAtIso = localDateTimeToIso(expiresAt);
    if (!expiresAtIso) {
      setError("Expiry must be a valid date and time.");
      return;
    }
    if (new Date(expiresAtIso).getTime() <= Date.now()) {
      setError("Expiry must be in the future.");
      return;
    }

    setSubmitting(true);
    try {
      const link = await createPaymentLink(me.merchant.id, {
        amountFils: amount,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        expiresAt: expiresAtIso,
      });
      navigate(`/dashboard/payment-links/${link.id}`, { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Preview only — mirrors what was typed, never what will be sent. The
  // submit handler above is still the one place the amount is validated.
  const previewAmount = Number(amountFils);
  const previewValid = amountFils.trim() !== "" && Number.isInteger(previewAmount) && previewAmount > 0;
  const previewExpiry = localDateTimeToIso(expiresAt);

  return (
    <section className="dash-page">
      <PageHeader
        back={{ to: "/dashboard/payment-links", label: "Payment links" }}
        title="New payment link"
        description="Set an amount and an expiry. You'll get a checkout link to send to your customer."
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <div className="dash-grid-detail">
        <Card title="Link details" labelledBy="link-details-title">
          <form className="dash-card-body dash-form" onSubmit={(e) => void handleSubmit(e)}>
            <label className="dash-field">
              Amount in fils
              <span className="dash-input-affix">
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={amountFils}
                  onChange={(e) => setAmountFils(e.target.value)}
                  aria-describedby="amount-hint"
                />
                <span className="dash-input-suffix">fils</span>
              </span>
              <span className="dash-field-hint" id="amount-hint">
                1000 fils = 1.000 BHD.
              </span>
            </label>
            <div className="dash-form-row">
              <label className="dash-field">
                <span className="dash-field-label">
                  Reference <span className="dash-field-optional">Optional</span>
                </span>
                <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <label className="dash-field">
                Expires at
                <input
                  type="datetime-local"
                  required
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </label>
            </div>
            <label className="dash-field">
              <span className="dash-field-label">
                Description <span className="dash-field-optional">Optional</span>
              </span>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="dash-actions">
              <button type="submit" className="dash-button dash-button-primary" disabled={submitting}>
                {submitting ? "Creating..." : "Create payment link"}
              </button>
              <Link className="dash-button" to="/dashboard/payment-links">
                Cancel
              </Link>
            </div>
          </form>
        </Card>

        <Card title="Your customer will see" labelledBy="link-preview-title" className="dash-preview">
          <div className="dash-card-body dash-preview-body">
            <span className="dash-muted">{me?.merchant.displayName ?? "Your business"}</span>
            {previewValid ? (
              <Money fils={previewAmount} size="xl" />
            ) : (
              <span className="dash-preview-placeholder">Enter an amount</span>
            )}
            <dl className="dash-summary">
              <div className="dash-summary-row">
                <dt>Reference</dt>
                <dd>{dash(reference.trim())}</dd>
              </div>
              <div className="dash-summary-row">
                <dt>Description</dt>
                <dd>{dash(description.trim())}</dd>
              </div>
              <div className="dash-summary-row">
                <dt>Expires</dt>
                <dd>{dateTime(previewExpiry)}</dd>
              </div>
            </dl>
          </div>
        </Card>
      </div>
    </section>
  );
}
