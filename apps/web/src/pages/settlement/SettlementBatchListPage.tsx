import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSettlementBatches } from "../../api/settlement.js";
import { describeError } from "../../api/client.js";
import { Pagination } from "../../components/Pagination.js";
import { EmptyRow, ErrorMessage, Loading, Money, PageHeader, StatusBadge, statusLabel } from "../../components/ui.js";
import { dateTime } from "../../format.js";
import { pluralize } from "../../utils/helpers.js";
import type { SettlementBatchDto, SettlementBatchStatus } from "../../types.js";

const STATUSES: SettlementBatchStatus[] = ["open", "closed", "paid"];
const PAGE_SIZE = 25;

/**
 * `GET /v1/settlement/batches` — `requireMerchantAuth` with no role
 * restriction — a batch list is not as sensitive as the reconciliation
 * report.
 *
 * `from`/`to` bound `batch_date`, a plain DATE column, so the raw YYYY-MM-DD
 * value from the date input goes through unchanged — no instant conversion,
 * because there is no timezone in the column to convert against.
 */
/** Filters by batch_date, which is a Bahrain business date. */
export function SettlementBatchListPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statuses, setStatuses] = useState<SettlementBatchStatus[]>([]);
  const [batches, setBatches] = useState<SettlementBatchDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listSettlementBatches({
          from: from || undefined,
          to: to || undefined,
          status: statuses.length > 0 ? statuses : undefined,
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
        });
        setBatches((previous) => (cursor ? [...previous, ...result.batches] : result.batches));
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [from, to, statuses],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggleStatus(status: SettlementBatchStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  return (
    <section className="dash-page">
      <PageHeader
        title="Settlement batches"
        description="One batch per Bahrain business day: what was captured, the fees taken, and the net amount paid out to you."
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <div className="dash-card">
        <div className="dash-toolbar">
          <fieldset className="dash-filters dash-filters-fields">
            <legend className="dash-visually-hidden">Batch date</legend>
            <label className="dash-field">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="dash-field">
              To (exclusive)
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </fieldset>
        </div>

        <div className="dash-filters-bar">
          <fieldset className="dash-filters">
            <legend>Status</legend>
            {STATUSES.map((status) => (
              <label key={status} className="dash-chip">
                <input
                  type="checkbox"
                  checked={statuses.includes(status)}
                  onChange={() => toggleStatus(status)}
                />
                {statusLabel(status)}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Batch date</th>
                <th>Status</th>
                <th className="dash-num">Gross</th>
                <th className="dash-num">Fee</th>
                <th className="dash-num">Refunds</th>
                <th className="dash-num">Net payout</th>
                <th>Closed</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="dash-nowrap">
                    <Link to={`/dashboard/settlement/${batch.id}`}>{batch.batchDate}</Link>
                  </td>
                  <td>
                    <StatusBadge status={batch.status} />
                  </td>
                  <td className="dash-num">
                    <Money fils={batch.grossFils} />
                  </td>
                  <td className="dash-num">
                    <Money fils={batch.feeFils} />
                  </td>
                  <td className="dash-num">
                    <Money fils={batch.refundedFils} />
                  </td>
                  <td className="dash-num dash-cell-strong">
                    <Money fils={batch.netPayoutFils} />
                  </td>
                  <td className="dash-nowrap">{dateTime(batch.closedAt)}</td>
                  <td className="dash-nowrap">{dateTime(batch.paidAt)}</td>
                </tr>
              ))}
              {batches.length === 0 && !loading ? (
                <EmptyRow colSpan={8}>No settlement batches match these filters.</EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>

        {loading ? <Loading /> : null}

        {nextCursor ? (
          <div className="dash-list-footer">
            <span>{pluralize(batches.length, "batch", "batches")} loaded</span>
            <Pagination nextCursor={nextCursor} loading={loading} onLoadMore={() => void load(nextCursor)} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
