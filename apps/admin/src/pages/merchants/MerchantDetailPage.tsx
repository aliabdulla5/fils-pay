import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatBhd, parseBhdToFils, toFils } from "@filspay/money";
import { getMerchant, recomputeTransactionStatuses, submitKycReview } from "../../api/merchants.js";
import { adjustBalance } from "../../api/balanceAdjustments.js";
import { issueCredit } from "../../api/credits.js";
import { rotateApiKey } from "../../api/apiKeys.js";
import { startImpersonation } from "../../api/impersonation.js";
import { describeError, WEB_BASE_URL } from "../../api/client.js";
import { useAdminAuth } from "../../auth/AdminAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { IconAlert, IconEye, IconKey, IconRefresh, IconWebhook } from "../../components/icons.js";
import {
  Card,
  EmptyRow,
  ErrorMessage,
  formatBps,
  GateNote,
  Loading,
  Money,
  Notice,
  PageHeader,
  StatusBadge,
} from "../../components/ui.js";
import type { AdminMerchantDetail, CreditReasonCode, RotatedApiKey } from "../../types.js";

function bhd(fils: number): string {
  return `${formatBhd(toFils(fils, { allowNegative: true }))} BHD`;
}

// browser local date not bahrain, fine for bahrain staff — am
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

export function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { rememberImpersonation } = useAdminAuth();

  const [detail, setDetail] = useState<AdminMerchantDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [kycNotes, setKycNotes] = useState("");
  const [busy, setBusy] = useState(false);

  /** Which key the operator has asked to rotate and not yet confirmed. */
  const [pendingRotation, setPendingRotation] = useState<string | null>(null);
  const [rotationLabel, setRotationLabel] = useState("");
  /** Shown exactly once: `rawKey` exists in the rotate response and nowhere else. */
  const [rotatedKey, setRotatedKey] = useState<RotatedApiKey | null>(null);

  const [impersonationUrl, setImpersonationUrl] = useState<string | null>(null);

  const [creditAmountBhd, setCreditAmountBhd] = useState("");
  const [creditReason, setCreditReason] = useState<CreditReasonCode>("goodwill");
  const [creditMemo, setCreditMemo] = useState("");
  const [creditReverseFee, setCreditReverseFee] = useState(false);
  const [creditEffectiveDate, setCreditEffectiveDate] = useState(todayIso());

  const [adjustDeltaFils, setAdjustDeltaFils] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      setDetail(await getMerchant(id));
    } catch (err) {
      setLoadError(describeError(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleKycReview(outcome: "approved" | "rejected"): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await submitKycReview(id, {
        outcome,
        notes: kycNotes.trim() ? kycNotes.trim() : undefined,
      });
      setNotice(
        `KYC ${outcome}. Onboarding status is now ${result.onboardingStatus} (kycPassed: ${String(
          result.kycPassed,
        )}).`,
      );
      setKycNotes("");
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  /** The old key keeps working for a 24h overlap window, then stops. */
  async function handleRotate(keyId: string): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const rotated = await rotateApiKey(id, keyId, {
        label: rotationLabel.trim() ? rotationLabel.trim() : undefined,
      });
      setRotatedKey(rotated);
      setPendingRotation(null);
      setRotationLabel("");
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // FH: this ends up in adjustMerchantBalanceCache (cache only)
  // MK: it's the journaled one since Sep
  async function handleAdjustBalance(): Promise<void> {
    if (!id) return;
    const deltaFils = Number(adjustDeltaFils.trim());
    if (!Number.isInteger(deltaFils) || deltaFils === 0) {
      setActionError("Enter a non-zero whole number of fils.");
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await adjustBalance(id, { deltaFils, reason: adjustReason.trim() });
      setNotice(
        `Balance adjusted by ${bhd(result.deltaFils)}: ${bhd(
          result.cachedPayableFilsBefore,
        )} → ${bhd(result.cachedPayableFilsAfter)}.`,
      );
      setAdjustDeltaFils("");
      setAdjustReason("");
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleIssueCredit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      // BD in, integer fils out, via the platform's own string-based parser —
      // never parseFloat, which cannot represent the third decimal exactly.
      const baseAmountFils = parseBhdToFils(creditAmountBhd);
      const record = await issueCredit(id, {
        baseAmountFils,
        reasonCode: creditReason,
        effectiveDate: creditEffectiveDate,
        reverseFee: creditReverseFee,
        memo: creditMemo.trim() ? creditMemo.trim() : undefined,
      });
      setNotice(
        record.status === "posted"
          ? `Credit of ${bhd(record.postedAmountFils)} posted to the ledger (entry group ${
              record.ledgerEntryGroupId ?? "unknown"
            }).`
          : `Credit of ${bhd(record.postedAmountFils)} raised and awaiting a second approver — see Credits.`,
      );
      setCreditAmountBhd("");
      setCreditMemo("");
      setCreditReverseFee(false);
      await load();
    } catch (err) {
      setActionError(err instanceof RangeError ? err.message : describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecomputeStatuses(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await recomputeTransactionStatuses(id);
      setNotice(
        `Scanned ${result.scanned} transaction${result.scanned === 1 ? "" : "s"}; ` +
          `${result.updated} status${result.updated === 1 ? "" : "es"} updated.`,
      );
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // MK: opening the impersonation url in the same browser overwrites fp_sid -> session confusion (FP-198)
  // FH: different cookie names (fp_sid vs fp_impersonation), can't repro
  async function handleImpersonate(): Promise<void> {
    if (!id || !detail) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const grant = await startImpersonation(id);
      rememberImpersonation({ ...grant, merchantDisplayName: detail.merchant.displayName });
      // The grant rides an httpOnly cookie set for apps/api's domain, which
      // apps/web already sends with `credentials: 'include'` — so the
      // merchant dashboard just works, unaware of how it was authenticated.
      // Opened in a second tab on purpose: this tab keeps showing the
      // impersonation banner and its exit action, which is the whole point
      // of the banner existing.
      const opened = window.open(WEB_BASE_URL, "_blank", "noopener");
      if (!opened) setImpersonationUrl(WEB_BASE_URL);
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const back = { to: "/merchants", label: "Merchants" };

  if (loadError) {
    return (
      <section className="admin-page">
        <PageHeader back={back} title="Merchant" />
        <ErrorMessage>{loadError}</ErrorMessage>
        <p>
          <Link to="/merchants">Back to merchants</Link>
        </p>
      </section>
    );
  }

  if (!detail) {
    return <Loading label="Loading merchant..." />;
  }

  const { merchant } = detail;
  const profile = detail.businessProfile;
  const apiKeys = detail.apiKeys ?? [];
  const webhookEndpoints = detail.webhookEndpoints ?? [];
  const kycReviews = detail.kycReviews ?? [];
  const batches = detail.recentSettlementBatches ?? [];

  return (
    <section className="admin-page">
      <PageHeader
        back={back}
        title={merchant.displayName}
        badge={
          <>
            <StatusBadge status={merchant.status} />
            <StatusBadge status={merchant.onboardingStatus} />
            <StatusBadge
              status={merchant.testMode ? "test" : "live"}
              label={merchant.testMode ? "test" : "live"}
            />
          </>
        }
        description={<code>{merchant.id}</code>}
        actions={
          <Link className="admin-button" to={`/webhooks/${merchant.id}`}>
            <IconWebhook />
            Replay webhooks
          </Link>
        }
      />

      {actionError ? <ErrorMessage>{actionError}</ErrorMessage> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      <div className="admin-figures">
        <div className="admin-figure">
          <span className="admin-figure-label">Cached payable</span>
          <span className="admin-figure-value">
            {detail.balance ? <Money fils={detail.balance.cachedPayableFils} size="lg" /> : "—"}
          </span>
          <span className="admin-figure-sub">
            {detail.balance
              ? `Updated ${new Date(detail.balance.updatedAt).toLocaleString()}`
              : "No cached balance row yet."}
          </span>
        </div>
        <div className="admin-figure">
          <span className="admin-figure-label">KYC</span>
          <span className="admin-figure-value">
            <StatusBadge
              status={merchant.kycPassed ? "passed" : "not_passed"}
              label={merchant.kycPassed ? "passed" : "not passed"}
            />
          </span>
        </div>
        <div className="admin-figure">
          <span className="admin-figure-label">MDR</span>
          <span className="admin-figure-value">{formatBps(merchant.mdrBps)}</span>
        </div>
        <div className="admin-figure">
          <span className="admin-figure-label">Current negotiated rate</span>
          <span className="admin-figure-value">
            {detail.currentFeeSchedule ? formatBps(detail.currentFeeSchedule.mdrBps) : "—"}
          </span>
          <span className="admin-figure-sub">
            {detail.currentFeeSchedule
              ? `Effective ${new Date(detail.currentFeeSchedule.effectiveFrom).toLocaleDateString()}`
              : "No negotiated schedule on file (uses MDR above)"}
          </span>
        </div>
        <div className="admin-figure">
          <span className="admin-figure-label">Created</span>
          <span className="admin-figure-value">{new Date(merchant.createdAt).toLocaleDateString()}</span>
          <span className="admin-figure-sub">{new Date(merchant.createdAt).toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="admin-grid-detail">
        <div className="admin-stack">
          <Card
            title="Profile"
            id="merchant-profile"
            footer={
              detail.balance
                ? "The ledger remains authoritative; the cached payable is a cache, rebuildable from Settlement ops."
                : undefined
            }
          >
            <div className="admin-card-body">
              {profile ? (
                <dl className="admin-dl">
                  <dt>Legal name</dt>
                  <dd>{profile.legalName}</dd>
                  <dt>Registration number</dt>
                  <dd>{profile.registrationNumber}</dd>
                  <dt>Business type</dt>
                  <dd>{profile.businessType}</dd>
                  <dt>Contact</dt>
                  <dd>
                    {profile.contactEmail} / {profile.contactPhone}
                  </dd>
                  <dt>Address</dt>
                  <dd>
                    {profile.addressLine1}
                    {profile.addressLine2 ? `, ${profile.addressLine2}` : ""}, {profile.city}
                    {profile.postalCode ? ` ${profile.postalCode}` : ""}, {profile.country}
                  </dd>
                </dl>
              ) : (
                <p className="admin-muted">No business profile submitted yet.</p>
              )}
            </div>
          </Card>

          <Card title="API keys" id="merchant-keys">
            {rotatedKey ? (
              <div className="admin-card-body">
                <div className="admin-confirm" role="alert">
                  <span className="admin-confirm-title">
                    <IconKey />
                    New key issued — copy it now.
                  </span>
                  <p>This value is shown once and is not recoverable afterwards.</p>
                  <code className="admin-secret">{rotatedKey.rawKey}</code>
                  <p className="admin-muted">
                    New key id <code>{rotatedKey.id}</code>, replacing previous key{" "}
                    <code>{rotatedKey.previousKeyId}</code>.
                  </p>
                  <div>
                    <button type="button" className="admin-button" onClick={() => setRotatedKey(null)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {pendingRotation ? (
              <div className="admin-card-body">
                <div className="admin-confirm">
                  <span className="admin-confirm-title">
                    <IconAlert />
                    Rotate this API key?
                  </span>
                  <p>
                    The current key is revoked and a replacement is issued in the same transaction, so
                    the merchant is never left without a working key — but any integration still
                    sending the old key will start failing immediately.
                  </p>
                  <label className="admin-field">
                    <span className="admin-field-label">
                      Label for the new key <span className="admin-field-optional">Optional</span>
                    </span>
                    <input
                      type="text"
                      value={rotationLabel}
                      onChange={(e) => setRotationLabel(e.target.value)}
                    />
                  </label>
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="admin-button admin-button-danger-solid"
                      disabled={busy}
                      onClick={() => void handleRotate(pendingRotation)}
                    >
                      {busy ? "Rotating..." : "Yes, rotate it"}
                    </button>
                    <button
                      type="button"
                      className="admin-button"
                      onClick={() => {
                        setPendingRotation(null);
                        setRotationLabel("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Prefix</th>
                    <th>Label</th>
                    <th>Created</th>
                    <th>Last used</th>
                    <th>Revoked</th>
                    <th className="admin-num">
                      <span className="admin-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <code>{key.prefix}</code>
                      </td>
                      <td>{key.label ?? "-"}</td>
                      <td className="admin-nowrap">{new Date(key.createdAt).toLocaleDateString()}</td>
                      <td className="admin-nowrap">
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "never"}
                      </td>
                      <td className="admin-nowrap">
                        {key.revokedAt ? (
                          <StatusBadge status="revoked" label={new Date(key.revokedAt).toLocaleString()} />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="admin-num">
                        {key.revokedAt ? null : (
                          <RequireRole
                            allow={["finance", "super_admin"]}
                            fallback={<span className="admin-muted">finance role required</span>}
                          >
                            <button
                              type="button"
                              className="admin-button admin-button-sm"
                              onClick={() => setPendingRotation(key.id)}
                            >
                              Rotate
                            </button>
                          </RequireRole>
                        )}
                      </td>
                    </tr>
                  ))}
                  {apiKeys.length === 0 ? <EmptyRow colSpan={6}>No API keys.</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Webhook endpoints"
            id="merchant-webhooks"
            aside={
              <Link to={`/webhooks/${merchant.id}`}>Replay a batch of deliveries for this merchant</Link>
            }
          >
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Secret prefix</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookEndpoints.map((endpoint) => (
                    <tr key={endpoint.id}>
                      <td>{endpoint.url}</td>
                      <td>
                        <StatusBadge status={endpoint.status} />
                      </td>
                      <td>
                        <code>{endpoint.secretPrefix}</code>
                      </td>
                      <td className="admin-nowrap">{new Date(endpoint.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {webhookEndpoints.length === 0 ? (
                    <EmptyRow colSpan={4}>No endpoints registered.</EmptyRow>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Recent settlement batches" id="merchant-batches">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="admin-num">Gross</th>
                    <th className="admin-num">Fee</th>
                    <th className="admin-num">Net payout</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <td className="admin-nowrap">{batch.batchDate}</td>
                      <td>
                        <StatusBadge status={batch.status} />
                      </td>
                      <td className="admin-num">
                        <Money fils={batch.grossFils} />
                      </td>
                      <td className="admin-num">
                        <Money fils={batch.feeFils} />
                      </td>
                      <td className="admin-num admin-cell-strong">
                        <Money fils={batch.netPayoutFils} />
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 ? <EmptyRow colSpan={5}>No batches yet.</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="KYC review history" id="merchant-kyc-history">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>Reviewer</th>
                    <th>Notes</th>
                    <th>Reviewed at</th>
                  </tr>
                </thead>
                <tbody>
                  {kycReviews.map((review) => (
                    <tr key={review.id}>
                      <td>
                        <StatusBadge status={review.outcome} />
                      </td>
                      <td>{review.reviewerIdentifier}</td>
                      <td>{review.notes ?? "-"}</td>
                      <td className="admin-nowrap">{new Date(review.reviewedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {kycReviews.length === 0 ? <EmptyRow colSpan={4}>No reviews recorded.</EmptyRow> : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="admin-stack">
          <Card title="View as merchant" id="merchant-impersonate" className="admin-card-danger">
            <div className="admin-card-body">
              <p className="admin-muted">
                Starts a short-lived, audited impersonation grant. It always acts with this
                merchant&apos;s least-privileged <code>support</code> role — never with your admin role —
                and it expires on its own. A banner stays on screen until you exit it.
              </p>
              <button
                type="button"
                className="admin-button admin-button-primary"
                disabled={busy}
                onClick={() => void handleImpersonate()}
              >
                <IconEye />
                View as merchant
              </button>
              {impersonationUrl ? (
                <p>
                  Your browser blocked the new tab —{" "}
                  <a href={impersonationUrl} target="_blank" rel="noreferrer">
                    open the merchant dashboard
                  </a>
                  .
                </p>
              ) : null}
            </div>
          </Card>

          <Card title="KYC review" id="merchant-kyc">
            <div className="admin-card-body">
              <p className="admin-muted">
                Approving or rejecting requires the <code>finance</code> or <code>super_admin</code>{" "}
                role; the API enforces it and answers <code>403</code> otherwise.
              </p>
              <RequireRole
                allow={["finance", "super_admin"]}
                fallback={<GateNote>Your role is read-only for KYC decisions. Ask a finance admin to review.</GateNote>}
              >
                <div className="admin-form">
                  <label className="admin-field">
                    <span className="admin-field-label">
                      Notes <span className="admin-field-optional">Optional</span>
                    </span>
                    <textarea value={kycNotes} onChange={(e) => setKycNotes(e.target.value)} rows={3} />
                  </label>
                  <div className="admin-actions">
                    <button
                      type="button"
                      className="admin-button admin-button-primary"
                      disabled={busy}
                      onClick={() => void handleKycReview("approved")}
                    >
                      Approve KYC
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button-danger"
                      disabled={busy}
                      onClick={() => void handleKycReview("rejected")}
                    >
                      Reject KYC
                    </button>
                  </div>
                </div>
              </RequireRole>
            </div>
          </Card>

          <Card title="Issue credit" id="merchant-credit">
            <div className="admin-card-body">
              <p className="admin-muted">
                Journals a manual credit to this merchant&apos;s payable balance. Above the approval
                limit it waits in <Link to="/credits">Credits</Link> for a second finance operator; at or
                below it, it posts immediately. The effective date is the accounting date the ledger legs
                are booked against.
              </p>
              <RequireRole
                allow={["finance", "super_admin"]}
                fallback={<GateNote>Your role cannot issue credits. Ask a finance admin.</GateNote>}
              >
                <form className="admin-form" onSubmit={(e) => void handleIssueCredit(e)}>
                  <label className="admin-field">
                    Amount (BD, up to 3 decimals)
                    <span className="admin-input-affix">
                      <input
                        type="text"
                        required
                        inputMode="decimal"
                        placeholder="50.000"
                        value={creditAmountBhd}
                        onChange={(e) => setCreditAmountBhd(e.target.value)}
                      />
                      <span className="admin-input-suffix">BHD</span>
                    </span>
                  </label>
                  <div className="admin-form-row">
                    <label className="admin-field">
                      Reason
                      <select
                        value={creditReason}
                        onChange={(e) => setCreditReason(e.target.value as CreditReasonCode)}
                      >
                        <option value="goodwill">Goodwill</option>
                        <option value="dispute_resolution">Dispute resolution</option>
                        <option value="correction">Correction</option>
                      </select>
                    </label>
                    <label className="admin-field">
                      Effective date
                      <input
                        type="date"
                        required
                        value={creditEffectiveDate}
                        onChange={(e) => setCreditEffectiveDate(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={creditReverseFee}
                      onChange={(e) => setCreditReverseFee(e.target.checked)}
                    />
                    <span>Also reverse the MDR on this amount ({(merchant.mdrBps / 100).toFixed(2)}%)</span>
                  </label>
                  <label className="admin-field">
                    <span className="admin-field-label">
                      Memo <span className="admin-field-optional">Optional</span>
                    </span>
                    <textarea value={creditMemo} onChange={(e) => setCreditMemo(e.target.value)} rows={2} />
                  </label>
                  <div>
                    <button type="submit" className="admin-button admin-button-primary" disabled={busy}>
                      {busy ? "Submitting..." : "Issue credit"}
                    </button>
                  </div>
                </form>
              </RequireRole>
            </div>
          </Card>

          <Card title="Adjust balance" id="merchant-adjust">
            <div className="admin-card-body">
              <p className="admin-muted">
                A direct correction to this merchant&apos;s cached payable balance, for when support has
                confirmed the figure on screen is wrong and it needs to be right now rather than after
                the next settlement cycle. Requires the <code>finance</code> or <code>super_admin</code>{" "}
                role.
              </p>
              <RequireRole
                allow={["finance", "super_admin"]}
                fallback={
                  <GateNote>Your role is read-only for balance corrections. Ask a finance admin.</GateNote>
                }
              >
                <div className="admin-form">
                  <label className="admin-field">
                    Delta (fils, may be negative)
                    <span className="admin-input-affix">
                      <input
                        value={adjustDeltaFils}
                        onChange={(e) => setAdjustDeltaFils(e.target.value)}
                        inputMode="numeric"
                        placeholder="50000"
                      />
                      <span className="admin-input-suffix">fils</span>
                    </span>
                  </label>
                  <label className="admin-field">
                    Reason
                    <input
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder="phone confirmation with merchant"
                    />
                  </label>
                  <div>
                    <button
                      type="button"
                      className="admin-button admin-button-primary"
                      disabled={busy || !adjustDeltaFils.trim() || !adjustReason.trim()}
                      onClick={() => void handleAdjustBalance()}
                    >
                      Adjust balance
                    </button>
                  </div>
                </div>
              </RequireRole>
            </div>
          </Card>

          <Card title="Recompute transaction statuses" id="merchant-recompute">
            <div className="admin-card-body">
              <p className="admin-muted">
                Re-derives this merchant&apos;s transaction statuses from their own captured/refunded
                amounts. Rows written before the refunds release can carry a status that predates the
                derivation rule; this backfills them. Rows that already agree are left alone.
              </p>
              <RequireRole
                allow={["finance", "super_admin"]}
                fallback={<GateNote>Your role cannot run this backfill. Ask a finance admin.</GateNote>}
              >
                <button
                  type="button"
                  className="admin-button"
                  disabled={busy}
                  onClick={() => void handleRecomputeStatuses()}
                >
                  <IconRefresh />
                  {busy ? "Working..." : "Recompute statuses"}
                </button>
              </RequireRole>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
