import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPaymentLinks } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { Pagination } from "../../components/Pagination.js";
import { IconPlus } from "../../components/icons.js";
import { EmptyRow, ErrorMessage, Loading, Money, PageHeader, StatusBadge, statusLabel } from "../../components/ui.js";
import { dash, dateTime } from "../../format.js";
import { pluralize } from "../../utils/helpers.js";
import type { PaymentLinkDto, PaymentLinkStatus } from "../../types.js";

/** The four *stored* statuses, including `reserved` — the merchant-facing
 *  list deliberately exposes it distinctly rather than collapsing it into the
 *  public enum's `processing`, because a merchant needs to see that a link is
 *  mid-payment-attempt. */
const STATUSES: PaymentLinkStatus[] = ["active", "reserved", "paid", "canceled"];

const PAGE_SIZE = 25;

/**
 * Keyset paginated, newest first.
 * — FH
 */
export function PaymentLinkListPage() {
  const { me } = useDashboardAuth();
  const merchantId = me?.merchant.id;

  const [statuses, setStatuses] = useState<PaymentLinkStatus[]>([]);
  const [links, setLinks] = useState<PaymentLinkDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      if (!merchantId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await listPaymentLinks(merchantId, {
          status: statuses.length > 0 ? statuses : undefined,
          limit: PAGE_SIZE,
          cursor: cursor ?? undefined,
        });
        setLinks((previous) => (cursor ? [...previous, ...result.paymentLinks] : result.paymentLinks));
        setNextCursor(result.nextCursor);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    },
    [merchantId, statuses],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function toggleStatus(status: PaymentLinkStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  return (
    <section className="dash-page">
      <PageHeader
        title="Payment links"
        description="Shareable checkout links for a fixed amount. Each link can be paid once."
        actions={
          <RequireRole allow={["owner", "finance"]}>
            <Link className="dash-button-link" to="/dashboard/payment-links/new">
              <IconPlus />
              New payment link
            </Link>
          </RequireRole>
        }
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <div className="dash-card">
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
                <th>Reference</th>
                <th>Description</th>
                <th className="dash-num">Amount</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Paid</th>
                <th>Canceled</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td>
                    <Link to={`/dashboard/payment-links/${link.id}`}>{dash(link.reference)}</Link>
                  </td>
                  <td>{dash(link.description)}</td>
                  <td className="dash-num dash-cell-strong">
                    <Money fils={link.amountFils} />
                  </td>
                  <td>
                    <StatusBadge status={link.status} />
                  </td>
                  <td className="dash-nowrap">{dateTime(link.expiresAt)}</td>
                  <td className="dash-nowrap">{dateTime(link.paidAt)}</td>
                  <td className="dash-nowrap">{dateTime(link.canceledAt)}</td>
                </tr>
              ))}
              {links.length === 0 && !loading ? (
                <EmptyRow colSpan={7}>No payment links match these filters.</EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>

        {loading ? <Loading /> : null}

        {nextCursor ? (
          <div className="dash-list-footer">
            <span>{pluralize(links.length, "link")} loaded</span>
            <Pagination nextCursor={nextCursor} loading={loading} onLoadMore={() => void load(nextCursor)} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
