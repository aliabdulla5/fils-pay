import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSettlementBatch, getSettlementBatchTransactions } from "../../api/settlement.js";
import { ApiError, describeError } from "../../api/client.js";
import { Card, EmptyRow, ErrorMessage, Loading, Money, PageHeader, StatusBadge } from "../../components/ui.js";
import { dash, dateTime } from "../../format.js";
import type { SettlementBatchDetailDto, SettlementBatchTransactionDto } from "../../types.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; batch: SettlementBatchDetailDto };

/**
 * `GET /v1/settlement/batches/:id` plus its line items.
 *
 * The two counts are rendered as two separately-labeled figures and never
 * added, averaged, or presented as one number: a transaction captured twice
 * inside the batch window contributes one scheme export line but two capture
 * events, so they can legitimately differ. Conflating them would invent a
 * discrepancy where there isn't one — or hide a real one.
 *
 * No pagination on the line items: the endpoint has none, and adding a
 * client-side cap would silently drop rows from a settlement figure.
 */
export function SettlementBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [lines, setLines] = useState<SettlementBatchTransactionDto[]>([]);

  useEffect(() => {
    if (!id) {
      setState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [batch, txns] = await Promise.all([
          getSettlementBatch(id),
          getSettlementBatchTransactions(id),
        ]);
        if (cancelled) return;
        setState({ kind: "loaded", batch });
        setLines(txns.transactions);
      } catch (err) {
        if (cancelled) return;
        // 404, not 403, for another merchant's batch — the same non-disclosure
        // choice the transaction detail read makes.
        if (err instanceof ApiError && err.statusCode === 404) {
          setState({ kind: "not_found" });
        } else {
          setState({ kind: "error", message: describeError(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const back = { to: "/dashboard/settlement", label: "Settlement batches" };

  if (state.kind === "loading") return <Loading />;
  if (state.kind === "not_found") {
    return (
      <section className="dash-page">
        <PageHeader back={back} title="Settlement batch not found" />
        <div className="dash-card dash-empty">
          <p>No settlement batch with this id exists on your account.</p>
          <Link to="/dashboard/settlement">Back to settlement batches</Link>
        </div>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className="dash-page">
        <PageHeader back={back} title="Settlement batch" />
        <ErrorMessage>{state.message}</ErrorMessage>
      </section>
    );
  }

  const { batch } = state;
  const displayProgress = parseFloat((batch.grossFils / 10000).toFixed(2));

  return (
    <section className="dash-page">
      <PageHeader
        back={back}
        title={`Settlement batch ${batch.batchDate}`}
        badge={<StatusBadge status={batch.status} />}
        description={<code>{batch.id}</code>}
      />

      <div className="dash-grid-detail">
        <div className="dash-stack">
          <div className="dash-card">
            <div className="dash-hero">
              <div>
                <span className="dash-hero-label">Net payout</span>
                <Money fils={batch.netPayoutFils} size="xl" />
              </div>
            </div>
            {batch.status === "closed" && (
              <div className="dash-card-body">
                <div className="dash-progress-bar">
                  <div className="dash-progress-fill" style={{ width: `${Math.min(displayProgress, 100)}%` }} />
                </div>
              </div>
            )}
            <div className="dash-figures">
              <div className="dash-figure">
                <span className="dash-figure-label">Gross</span>
                <span className="dash-figure-value">
                  <Money fils={batch.grossFils} />
                </span>
              </div>
              <div className="dash-figure">
                <span className="dash-figure-label">Fee</span>
                <span className="dash-figure-value">
                  <Money fils={batch.feeFils} />
                </span>
              </div>
              <div className="dash-figure">
                <span className="dash-figure-label">Refunds</span>
                <span className="dash-figure-value">
                  <Money fils={batch.refundedFils} />
                </span>
              </div>
              <div className="dash-figure">
                <span className="dash-figure-label">Fee reversed on refunds</span>
                <span className="dash-figure-value">
                  <Money fils={batch.feeReversedFils} />
                </span>
              </div>
            </div>
          </div>

          <Card
            title="Included transactions"
            labelledBy="batch-lines-title"
            footer={
              <>
                The scheme amount is the card-network export figure, quantized to two
                decimal places at that boundary — it can be up to 9 fils below the
                captured amount by design.
              </>
            }
          >
            <div className="dash-table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="dash-num">Line</th>
                    <th>Transaction</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th className="dash-num">Authorized</th>
                    <th className="dash-num">Captured</th>
                    <th className="dash-num">Scheme amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={`${line.transactionId}-${line.lineSequence}`}>
                      <td className="dash-num">{line.lineSequence}</td>
                      <td>
                        <Link to={`/dashboard/transactions/${line.transactionId}`}>
                          <code>{line.transactionId}</code>
                        </Link>
                      </td>
                      <td className="dash-nowrap">{dash(line.reference)}</td>
                      <td>
                        <StatusBadge status={line.status} />
                      </td>
                      <td className="dash-num">
                        <Money fils={line.authorizedFils} />
                      </td>
                      <td className="dash-num">
                        <Money fils={line.capturedFils} />
                      </td>
                      <td className="dash-num dash-cell-strong">
                        <Money fils={line.schemeAmountFils} />
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 ? (
                    <EmptyRow colSpan={7}>No scheme export lines in this batch.</EmptyRow>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card title="Details" labelledBy="batch-details-title">
          <div className="dash-card-body">
            <dl className="dash-dl dash-dl-stacked">
              <dt>Status</dt>
              <dd>
                <StatusBadge status={batch.status} />
              </dd>
              <dt>Closed at</dt>
              <dd>{dateTime(batch.closedAt)}</dd>
              <dt>Paid at</dt>
              <dd>{dateTime(batch.paidAt)}</dd>
              <dt>Included transactions</dt>
              <dd>{batch.includedTransactionCount}</dd>
              <dt>Capture events in this batch</dt>
              <dd>
                {batch.includedEventCount}
                {batch.includedEventCount !== batch.includedTransactionCount ? (
                  <span className="dash-field-hint dash-block">
                    More events than transactions is normal: a transaction captured
                    more than once in this window contributes one export line and
                    several events.
                  </span>
                ) : null}
              </dd>
            </dl>
          </div>
        </Card>
      </div>
    </section>
  );
}
