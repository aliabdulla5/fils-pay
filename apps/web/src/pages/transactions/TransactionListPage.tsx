import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTransactions } from "../../api/transactions.js";
import { describeError } from "../../api/client.js";
import { Pagination } from "../../components/Pagination.js";
import { IconSearch } from "../../components/icons.js";
import { EmptyRow, ErrorMessage, Loading, Money, PageHeader, StatusBadge, statusLabel } from "../../components/ui.js";
import { dash, dateTime, dayStartIso } from "../../format.js";
import { pluralize, truncateMiddle } from "../../utils/helpers.js";
import type { TransactionDto, TransactionStatus } from "../../types.js";

const STATUSES: TransactionStatus[] = [
  "authorized",
  "captured",
  "partially_captured",
  "voided",
  "partially_refunded",
  "refunded",
  "chargeback",
];

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * `GET /v1/transactions`. Every control here is a real server-side
 * query param — nothing fetches an unfiltered page and narrows it in the
 * browser, which would both lie about the result count and break pagination.
 */
// YA: from/to are UTC day starts, see dayStartIso
export function TransactionListPage() {
  const [statuses, setStatuses] = useState<TransactionStatus[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [transactions, setTransactions] = useState<TransactionDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce only the text box — the checkbox/date controls fire immediately,
  // since those are discrete choices, not a stream of keystrokes.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listTransactions({
          status: statuses.length > 0 ? statuses : undefined,
          from: dayStartIso(from),
          to: dayStartIso(to),
          search: search || undefined,
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
        });
        setTransactions((previous) =>
          cursor ? [...previous, ...result.transactions] : result.transactions,
        );
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [statuses, from, to, search],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggleStatus(status: TransactionStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  return (
    <section className="dash-page">
      <PageHeader
        title="Transactions"
        description="Every card payment on your account, newest first. Open one to capture, void or refund it."
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <div className="dash-card">
        <div className="dash-toolbar">
          <label className="dash-field dash-field-grow">
            Search
            <span className="dash-input-affix">
              <IconSearch />
              <input
                type="search"
                placeholder="Reference, acquirer reference, or transaction id"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </span>
          </label>
          <label className="dash-field">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="dash-field">
            {/* Exclusive, because the endpoint's own predicate is
                `occurred_at < to` — labelled rather than quietly shifted by a
                day here, which would make this page and the API disagree about
                what a filter means. */}
            To (exclusive)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
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
                <th>Occurred</th>
                <th>Reference</th>
                <th>Status</th>
                <th className="dash-num">Authorized</th>
                <th className="dash-num">Captured</th>
                <th>Acquirer reference</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id}>
                  <td className="dash-nowrap">
                    <Link to={`/dashboard/transactions/${txn.id}`}>{dateTime(txn.occurredAt)}</Link>
                  </td>
                  <td className="dash-nowrap">{dash(txn.reference)}</td>
                  <td>
                    <StatusBadge status={txn.status} />
                  </td>
                  <td className="dash-num">
                    <Money fils={txn.amountFils} />
                  </td>
                  <td className="dash-num dash-cell-strong">
                    <Money fils={txn.capturedFils} />
                  </td>
                  <td>
                    <code>{truncateMiddle(txn.acquirerReference, 20)}</code>
                  </td>
                </tr>
              ))}
              {transactions.length === 0 && !loading ? (
                <EmptyRow colSpan={6}>No transactions match these filters.</EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>

        {loading ? <Loading /> : null}

        <div className="dash-list-footer">
          <span>{pluralize(transactions.length, "transaction")} loaded</span>
          <Pagination nextCursor={nextCursor} loading={loading} onLoadMore={() => void load(nextCursor)} />
        </div>
      </div>
    </section>
  );
}
