import { useState } from "react";
import { rebuildAnalytics, rebuildBalances, runBatch } from "../../api/settlement.js";
import { recalculateMdr } from "../../api/mdrRecalculation.js";
import { describeError } from "../../api/client.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { IconAlert, IconCheck, IconRefresh } from "../../components/icons.js";
import { Card, ErrorMessage, GateNote, Money, PageHeader, StatusBadge } from "../../components/ui.js";
import type {
  AnalyticsRebuildSummary,
  BalanceRebuildSummary,
  MdrRecalcSummary,
  RunBatchSummary,
} from "../../types.js";

// The last completed Asia/Bahrain business day (UTC+3, no DST), whatever
// the browser's zone. Local "yesterday" printed with toISOString() was a UTC
// date: from 00:00 to 03:00 Bahrain time it defaulted to two days ago.
function yesterdayIso(): string {
  return new Date(Date.now() + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
}

/**
 * The two cross-process operations. Both are `finance` /
 * `super_admin` server-side; both write their audit row *before* the call
 * crosses the network, so an attempt is on record even if the settlement
 * service never answers.
 *
 * The analytics rebuild at the bottom is the same role gate and the same
 * confirm-before-you-run shape, but it never leaves apps/api — it is one
 * transaction of SQL, so its audit row is simply part of that transaction.
 */
export function SettlementPage() {
  const [date, setDate] = useState(yesterdayIso());
  const [merchantId, setMerchantId] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunBatchSummary | null>(null);

  const [confirmingRebuild, setConfirmingRebuild] = useState(false);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [rebuildResult, setRebuildResult] = useState<BalanceRebuildSummary | null>(null);

  const [confirmingAnalytics, setConfirmingAnalytics] = useState(false);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsResult, setAnalyticsResult] = useState<AnalyticsRebuildSummary | null>(null);

  const [mdrMerchantId, setMdrMerchantId] = useState("");
  const [mdrFrom, setMdrFrom] = useState("");
  const [mdrTo, setMdrTo] = useState("");
  const [mdrBusy, setMdrBusy] = useState(false);
  const [mdrError, setMdrError] = useState<string | null>(null);
  const [mdrResult, setMdrResult] = useState<MdrRecalcSummary | null>(null);

  /** Idempotent per business date: re-running returns the already-closed batches. */
  async function handleRunBatch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setRunBusy(true);
    setRunError(null);
    setRunResult(null);
    try {
      setRunResult(
        await runBatch({ date, merchantId: merchantId.trim() ? merchantId.trim() : undefined }),
      );
    } catch (err) {
      setRunError(describeError(err));
    } finally {
      setRunBusy(false);
    }
  }

  // after clicking rebuild on staging alpha's balance jumped to like 3x?? — am
  // MK: staging data is junk. cache-only, safe to click
  async function handleRebuild(): Promise<void> {
    setRebuildBusy(true);
    setRebuildError(null);
    setRebuildResult(null);
    try {
      setRebuildResult(await rebuildBalances());
      setConfirmingRebuild(false);
    } catch (err) {
      setRebuildError(describeError(err));
    } finally {
      setRebuildBusy(false);
    }
  }

  async function handleRebuildAnalytics(): Promise<void> {
    setAnalyticsBusy(true);
    setAnalyticsError(null);
    setAnalyticsResult(null);
    try {
      setAnalyticsResult(await rebuildAnalytics());
      setConfirmingAnalytics(false);
    } catch (err) {
      setAnalyticsError(describeError(err));
    } finally {
      setAnalyticsBusy(false);
    }
  }

  // FH: ADMIN.md says this is safe
  async function handleRecalculateMdr(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setMdrBusy(true);
    setMdrError(null);
    setMdrResult(null);
    try {
      setMdrResult(await recalculateMdr(mdrMerchantId.trim(), { from: mdrFrom, to: mdrTo }));
    } catch (err) {
      setMdrError(describeError(err));
    } finally {
      setMdrBusy(false);
    }
  }

  const runResults = runResult?.merchantResults ?? [];
  const mdrAdjusted = mdrResult?.adjusted ?? [];
  const rebuildChanged = rebuildResult?.changed ?? [];

  return (
    <section className="admin-page">
      <PageHeader
        title="Settlement ops"
        description={
          <>
            Every action below is money-adjacent and is gated server-side to the <code>finance</code>{" "}
            and <code>super_admin</code> roles. Every invocation is written to the admin audit log
            before it runs.
          </>
        }
      />

      <p className="admin-section-label">Per date and per merchant</p>
      <div className="admin-grid-ops">
        <Card
          title="Re-run a daily batch"
          id="op-run-batch"
          aside={<OpState busy={runBusy} error={runError} done={runResult !== null} busyLabel="Running" />}
        >
          <div className="admin-card-body">
            <p className="admin-muted">
              Closes and pays out the batch for one business date. Running a date that is already
              closed or paid is safe — the settlement service reports it as already-done rather than
              doing it twice.
            </p>

            {runError ? <ErrorMessage>{runError}</ErrorMessage> : null}

            <RequireRole
              allow={["finance", "super_admin"]}
              fallback={<GateNote>Your role cannot trigger settlement runs. Ask a finance admin.</GateNote>}
            >
              <form className="admin-form" onSubmit={(e) => void handleRunBatch(e)}>
                <label className="admin-field">
                  Business date
                  <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="admin-field">
                  <span className="admin-field-label">
                    Merchant id <span className="admin-field-optional">Optional</span>
                  </span>
                  <input
                    type="text"
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={merchantId}
                    onChange={(e) => setMerchantId(e.target.value)}
                  />
                  <span className="admin-field-hint">Leave blank to run every eligible merchant.</span>
                </label>
                <div>
                  <button
                    type="submit"
                    className={runBusy ? "admin-button admin-button-primary admin-button-busy" : "admin-button admin-button-primary"}
                    disabled={runBusy}
                  >
                    {runBusy ? "Running..." : "Run batch"}
                  </button>
                </div>
              </form>
            </RequireRole>
          </div>

          {runResult ? (
            <div className="admin-card-body">
              <div className="admin-result">
                <div className="admin-result-head">
                  <IconCheck />
                  Batch run for {runResult.businessDate} — {runResults.length} merchant
                  {runResults.length === 1 ? "" : "s"} processed.
                </div>
                {runResults.length > 0 ? (
                  <div className="admin-result-body admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Merchant</th>
                          <th>Batch</th>
                          <th className="admin-num">Gross</th>
                          <th className="admin-num">Fee</th>
                          <th className="admin-num">Net payout</th>
                          <th>Already closed</th>
                          <th>Already paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runResults.map((outcome) => (
                          <tr key={`${outcome.merchantId}-${outcome.batchId}`}>
                            <td>
                              <code>{outcome.merchantId}</code>
                            </td>
                            <td>
                              <code>{outcome.batchId}</code>
                            </td>
                            <td className="admin-num">
                              <Money fils={outcome.grossFils} />
                            </td>
                            <td className="admin-num">
                              <Money fils={outcome.feeFils} />
                            </td>
                            <td className="admin-num admin-cell-strong">
                              <Money fils={outcome.netPayoutFils} />
                            </td>
                            <td>{outcome.alreadyClosed ? "yes" : "no"}</td>
                            <td>{outcome.alreadyPaid ? "yes" : "no"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>

        <Card
          title="Recalculate MDR"
          id="op-mdr"
          aside={<OpState busy={mdrBusy} error={mdrError} done={mdrResult !== null} busyLabel="Recalculating" />}
        >
          <div className="admin-card-body">
            <p className="admin-muted">
              Re-derives one merchant&apos;s settlement-batch fees over a date range at their current
              contracted rate, and posts a ledger adjustment for any difference. Finance runs this after
              a rate change lands so historical batches reflect the same figure a fresh reconciliation
              would show.
            </p>
            <RequireRole
              allow={["finance", "super_admin"]}
              fallback={<GateNote>Your role cannot run an MDR recalculation. Ask a finance admin.</GateNote>}
            >
              <form className="admin-form" onSubmit={(e) => void handleRecalculateMdr(e)}>
                <label className="admin-field">
                  Merchant id
                  <input
                    value={mdrMerchantId}
                    onChange={(e) => setMdrMerchantId(e.target.value)}
                    placeholder="merchant UUID"
                    required
                  />
                </label>
                <div className="admin-form-row">
                  <label className="admin-field">
                    From (inclusive)
                    <input type="date" value={mdrFrom} onChange={(e) => setMdrFrom(e.target.value)} required />
                  </label>
                  <label className="admin-field">
                    To (exclusive)
                    <input type="date" value={mdrTo} onChange={(e) => setMdrTo(e.target.value)} required />
                  </label>
                </div>
                <div>
                  <button
                    type="submit"
                    className={mdrBusy ? "admin-button admin-button-primary admin-button-busy" : "admin-button admin-button-primary"}
                    disabled={mdrBusy}
                  >
                    {mdrBusy ? "Recalculating…" : "Recalculate MDR"}
                  </button>
                </div>
              </form>
            </RequireRole>

            {mdrError ? <ErrorMessage>{mdrError}</ErrorMessage> : null}
          </div>

          {mdrResult ? (
            <div className="admin-card-body">
              <div className="admin-result">
                <div className="admin-result-head">
                  <IconCheck />
                  Considered {mdrResult.batchesConsidered} batch(es); {mdrAdjusted.length} had a fee
                  change.
                </div>
                <div className="admin-result-body">
                  {mdrAdjusted.length > 0 ? (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Batch date</th>
                            <th>Status</th>
                            <th className="admin-num">Old fee</th>
                            <th className="admin-num">New fee</th>
                            <th className="admin-num">Difference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mdrAdjusted.map((adjustment) => (
                            <tr key={adjustment.batchId}>
                              <td className="admin-nowrap">{adjustment.batchDate}</td>
                              <td>
                                <StatusBadge status={adjustment.status} />
                              </td>
                              <td className="admin-num">
                                <Money fils={adjustment.oldFeeFils} />
                              </td>
                              <td className="admin-num">
                                <Money fils={adjustment.newFeeFils} />
                              </td>
                              <td className="admin-num admin-cell-strong">
                                <Money fils={adjustment.diffFils} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="admin-muted">Every batch in range already matched the current rate.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <p className="admin-section-label">Platform-wide</p>
      <div className="admin-grid-ops">
        <Card
          title="Rebuild cached balances"
          id="op-rebuild-balances"
          className="admin-card-danger"
          aside={
            <>
              <span className="admin-tag admin-tag-warning">Affects every merchant</span>
              <OpState
                busy={rebuildBusy}
                error={rebuildError}
                done={rebuildResult !== null}
                busyLabel="Rebuilding"
              />
            </>
          }
        >
          <div className="admin-card-body">
            <p className="admin-muted">
              Recomputes every merchant&apos;s cached payable balance from <code>ledger_entries</code>,
              the authoritative record. The ledger itself is only read, never written — but this
              touches every merchant on the platform at once, so it asks before it runs.
            </p>

            {rebuildError ? <ErrorMessage>{rebuildError}</ErrorMessage> : null}

            <RequireRole
              allow={["finance", "super_admin"]}
              fallback={<GateNote>Your role cannot rebuild balances. Ask a finance admin.</GateNote>}
            >
              {confirmingRebuild ? (
                <div className="admin-confirm">
                  <span className="admin-confirm-title">
                    <IconAlert />
                    Rebuild balances for every merchant?
                  </span>
                  <p>
                    This recalculates all cached payable balances and records the action in the admin
                    audit log.
                  </p>
                  <div className="admin-actions">
                    <button
                      type="button"
                      className={
                        rebuildBusy
                          ? "admin-button admin-button-danger-solid admin-button-busy"
                          : "admin-button admin-button-danger-solid"
                      }
                      disabled={rebuildBusy}
                      onClick={() => void handleRebuild()}
                    >
                      {rebuildBusy ? "Rebuilding..." : "Yes, rebuild all balances"}
                    </button>
                    <button
                      type="button"
                      className="admin-button"
                      disabled={rebuildBusy}
                      onClick={() => setConfirmingRebuild(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button type="button" className="admin-button" onClick={() => setConfirmingRebuild(true)}>
                    <IconRefresh />
                    Rebuild balances
                  </button>
                </div>
              )}
            </RequireRole>
          </div>

          {rebuildResult ? (
            <div className="admin-card-body">
              <div className="admin-result">
                <div className="admin-result-head">
                  <IconCheck />
                  Rebuilt {rebuildResult.rebuiltCount} balance
                  {rebuildResult.rebuiltCount === 1 ? "" : "s"}; {rebuildChanged.length} changed.
                </div>
                <div className="admin-result-body">
                  {rebuildChanged.length > 0 ? (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Merchant</th>
                            <th className="admin-num">Before</th>
                            <th className="admin-num">After</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rebuildChanged.map((change) => (
                            <tr key={change.merchantId}>
                              <td>
                                <code>{change.merchantId}</code>
                              </td>
                              <td className="admin-num">
                                <Money fils={change.before} />
                              </td>
                              <td className="admin-num admin-cell-strong">
                                <Money fils={change.after} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="admin-muted">Every cached balance already matched the ledger.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </Card>

        <Card
          title="Rebuild analytics"
          id="op-rebuild-analytics"
          className="admin-card-danger"
          aside={
            <>
              <span className="admin-tag admin-tag-warning">Affects every merchant</span>
              <OpState
                busy={analyticsBusy}
                error={analyticsError}
                done={analyticsResult !== null}
                busyLabel="Rebuilding"
              />
            </>
          }
        >
          <div className="admin-card-body">
            <p className="admin-muted">
              Recomputes the analytics read model — daily volumes and payout trends — from scratch, for
              when a merchant reports their dashboard looking behind and you would rather not wait for
              the reporting worker to catch up. Like the balance rebuild, it touches every merchant at
              once, so it asks before it runs.
            </p>

            {analyticsError ? <ErrorMessage>{analyticsError}</ErrorMessage> : null}

            <RequireRole
              allow={["finance", "super_admin"]}
              fallback={<GateNote>Your role cannot rebuild analytics. Ask a finance admin.</GateNote>}
            >
              {confirmingAnalytics ? (
                <div className="admin-confirm">
                  <span className="admin-confirm-title">
                    <IconAlert />
                    Rebuild analytics for every merchant?
                  </span>
                  <p>
                    This replaces both rollup tables with a fresh recompute and records the action in
                    the admin audit log.
                  </p>
                  <div className="admin-actions">
                    <button
                      type="button"
                      className={
                        analyticsBusy
                          ? "admin-button admin-button-danger-solid admin-button-busy"
                          : "admin-button admin-button-danger-solid"
                      }
                      disabled={analyticsBusy}
                      onClick={() => void handleRebuildAnalytics()}
                    >
                      {analyticsBusy ? "Rebuilding..." : "Yes, rebuild analytics"}
                    </button>
                    <button
                      type="button"
                      className="admin-button"
                      disabled={analyticsBusy}
                      onClick={() => setConfirmingAnalytics(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button type="button" className="admin-button" onClick={() => setConfirmingAnalytics(true)}>
                    <IconRefresh />
                    Rebuild analytics
                  </button>
                </div>
              )}
            </RequireRole>
          </div>

          {analyticsResult ? (
            <div className="admin-card-body">
              <div className="admin-result">
                <div className="admin-result-head">
                  <IconCheck />
                  Rebuilt {analyticsResult.volumeRows} daily-volume row
                  {analyticsResult.volumeRows === 1 ? "" : "s"} and {analyticsResult.trendRows}{" "}
                  payout-trend row{analyticsResult.trendRows === 1 ? "" : "s"}.
                </div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

/** The header badge on each operation card: what the last invocation on
 *  this screen is doing or did. Display only — reflects the handler's own
 *  busy/error/result state. */
function OpState({
  busy,
  error,
  done,
  busyLabel,
}: {
  busy: boolean;
  error: string | null;
  done: boolean;
  busyLabel: string;
}) {
  if (busy) return <span className="admin-badge admin-badge-warning admin-badge-processing">{busyLabel}</span>;
  if (error) return <StatusBadge status="failed" />;
  if (done) return <StatusBadge status="succeeded" label="Completed" />;
  return null;
}
