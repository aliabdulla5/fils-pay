import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPayoutTrends, getTopLinks, getVolumes } from "../../api/analytics.js";
import { describeError } from "../../api/client.js";
import { StalenessBadge } from "../../components/StalenessBadge.js";
import { IconRefresh } from "../../components/icons.js";
import { Card, EmptyRow, ErrorMessage, Loading, Money, PageHeader, StatusBadge } from "../../components/ui.js";
import { bhd, dash, dateTime } from "../../format.js";
import { formatCount, pluralize } from "../../utils/helpers.js";
import type { PayoutTrendsResponse, TopLinksResponse, VolumesResponse } from "../../types.js";

/** 60s: comfortably above the reporting worker's 15s worst-case lag, and
 *  more than often enough for a dashboard. Poll, not push —
 *  there is no websocket or SSE anywhere in this platform, and this page does
 *  not introduce the first one. */
const POLL_MS = 60_000;

export function OverviewPage() {
  // Left blank, the server applies its own "last 30 Asia/Bahrain days"
  // default — the client does not compute a competing one.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [topLinksLimit, setTopLinksLimit] = useState(10);

  const [volumes, setVolumes] = useState<VolumesResponse | null>(null);
  const [payouts, setPayouts] = useState<PayoutTrendsResponse | null>(null);
  const [topLinks, setTopLinks] = useState<TopLinksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mirrors the server's own clamp so this page never displays a limit the
  // server would have silently overridden.
  const clampedLimit = Math.min(50, Math.max(1, Math.trunc(topLinksLimit) || 10));

  const load = useCallback(async () => {
    const range = { from: from || undefined, to: to || undefined };
    setLoading(true);
    setError(null);
    try {
      // Three independent endpoints, three independent fetches — there is no
      // combined route to call.
      const [v, p, t] = await Promise.all([
        getVolumes(range),
        getPayoutTrends(range),
        getTopLinks({ ...range, limit: clampedLimit }),
      ]);
      setVolumes(v);
      setPayouts(p);
      setTopLinks(t);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [from, to, clampedLimit]);

  // overview memory leak (heap +40mb/hr), pretty sure its these effects — am
  // FH: profiled for 1h, heap flat. maybe it was a browser extension? open
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const peakGross = Math.max(1, ...(volumes?.points.map((point) => point.capturedGrossFils) ?? [1]));

  // Summary figures: plain integer sums over the rows these three responses
  // already returned — no new endpoint, no estimate, nothing the tables
  // below don't also show line by line.
  const volumePoints = volumes?.points ?? [];
  const capturedGrossTotal = volumePoints.reduce((sum, point) => sum + point.capturedGrossFils, 0);
  const capturedCountTotal = volumePoints.reduce((sum, point) => sum + point.capturedCount, 0);
  const voidedCountTotal = volumePoints.reduce((sum, point) => sum + point.voidedCount, 0);
  const payoutPoints = payouts?.points ?? [];
  const netPayoutTotal = payoutPoints.reduce((sum, point) => sum + point.netPayoutFils, 0);
  const paidBatchCount = payoutPoints.filter((point) => point.paidAt !== null).length;
  const topLinkRows = topLinks?.links ?? [];
  const topLinksTotal = topLinkRows.reduce((sum, link) => sum + link.amountFils, 0);
  const topLinkPeak = Math.max(1, ...topLinkRows.map((link) => link.amountFils));
  const peakIndex = volumePoints.findIndex((point) => point.capturedGrossFils === peakGross);
  const firstLoad = loading && !volumes && !payouts && !topLinks;

  return (
    <section className="dash-page">
      <PageHeader
        title="Overview"
        description="Captured volume, payouts and your best-performing payment links. Leave the dates blank for the last 30 days."
      />

      <form
        className="dash-card dash-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="dash-field">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="dash-field">
          To (exclusive)
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="dash-field">
          Top links
          <input
            type="number"
            min={1}
            max={50}
            value={topLinksLimit}
            onChange={(e) => setTopLinksLimit(Number(e.target.value))}
          />
        </label>
        <button type="submit" className="dash-button dash-button-primary" disabled={loading}>
          <IconRefresh />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </form>

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      {firstLoad ? <Loading label="Loading analytics..." /> : null}

      {volumes || payouts || topLinks ? (
        <div className="dash-metrics">
          <div className="dash-metric">
            <span className="dash-metric-label">Captured volume</span>
            <span className="dash-metric-value">{volumes ? <Money fils={capturedGrossTotal} /> : "—"}</span>
            <span className="dash-metric-foot">
              {volumes ? <StalenessBadge readModelAsOf={volumes.readModelAsOf} live={volumes.live} /> : null}
            </span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Captured payments</span>
            <span className="dash-metric-value">{volumes ? formatCount(capturedCountTotal) : "—"}</span>
            <span className="dash-metric-foot">
              {volumes ? (
                <>
                  <span>{pluralize(voidedCountTotal, "void")}</span>
                  <StalenessBadge readModelAsOf={volumes.readModelAsOf} live={volumes.live} />
                </>
              ) : null}
            </span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Net payouts</span>
            <span className="dash-metric-value">{payouts ? <Money fils={netPayoutTotal} /> : "—"}</span>
            <span className="dash-metric-foot">
              {payouts ? (
                <>
                  <span>
                    {paidBatchCount} of {pluralize(payoutPoints.length, "batch", "batches")} paid
                  </span>
                  <StalenessBadge readModelAsOf={payouts.readModelAsOf} live={payouts.live} />
                </>
              ) : null}
            </span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Top {clampedLimit} paid links</span>
            <span className="dash-metric-value">{topLinks ? <Money fils={topLinksTotal} /> : "—"}</span>
            <span className="dash-metric-foot">
              {topLinks ? (
                <>
                  <span>{pluralize(topLinkRows.length, "link")}</span>
                  <StalenessBadge readModelAsOf={topLinks.readModelAsOf} live={topLinks.live} />
                </>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}

      <Card
        labelledBy="overview-volume"
        title="Captured volume"
        aside={volumes ? <StalenessBadge readModelAsOf={volumes.readModelAsOf} live={volumes.live} /> : null}
      >
        {volumePoints.length > 0 ? (
          <div className="dash-chart">
            {/* A plain CSS column chart, scaled to the window's own peak — no
                charting library, no new dependency. Decorative for assistive
                tech: the table below carries the same figures. */}
            <div className="dash-chart-plot" aria-hidden="true">
              {volumePoints.map((point, index) => (
                <div
                  key={point.date}
                  className={index === peakIndex ? "dash-chart-col is-peak" : "dash-chart-col"}
                  title={`${point.date}: ${bhd(point.capturedGrossFils)} · ${formatCount(point.capturedCount)} captured`}
                >
                  <span
                    className="dash-chart-bar"
                    style={{ height: `${(point.capturedGrossFils / peakGross) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="dash-chart-axis" aria-hidden="true">
              <span>{volumePoints[0]?.date}</span>
              <span>{volumePoints[volumePoints.length - 1]?.date}</span>
            </div>
            <div className="dash-chart-legend" aria-hidden="true">
              <span>Daily captured gross</span>
              <span className="is-peak">Peak day</span>
            </div>
          </div>
        ) : null}
        <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="dash-num">Captured</th>
                <th className="dash-num">Gross</th>
                <th className="dash-num">Voided</th>
                <th className="dash-bar-cell">
                  <span className="dash-visually-hidden">Share of peak day</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {volumePoints.map((point) => (
                <tr key={point.date}>
                  <td className="dash-nowrap">{point.date}</td>
                  <td className="dash-num">{formatCount(point.capturedCount)}</td>
                  <td className="dash-num">
                    <Money fils={point.capturedGrossFils} />
                  </td>
                  <td className="dash-num">{formatCount(point.voidedCount)}</td>
                  <td className="dash-bar-cell">
                    {/* A plain CSS bar, scaled to the window's own peak — no
                        charting library, no new dependency. */}
                    <span className="dash-bar-track">
                      <span
                        className="dash-bar"
                        style={{ width: `${(point.capturedGrossFils / peakGross) * 100}%` }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
              {volumes && volumes.points.length === 0 ? (
                <EmptyRow colSpan={5}>No captured volume in this window.</EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="dash-stack">
        <Card
          labelledBy="overview-payouts"
          title="Payout trends"
          aside={payouts ? <StalenessBadge readModelAsOf={payouts.readModelAsOf} live={payouts.live} /> : null}
        >
          <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Batch date</th>
                  <th>Status</th>
                  <th className="dash-num">Gross</th>
                  <th className="dash-num">Fee</th>
                  <th className="dash-num">Net payout</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {payoutPoints.map((point) => (
                  <tr key={point.settlementBatchId}>
                    <td className="dash-nowrap">
                      <Link to={`/dashboard/settlement/${point.settlementBatchId}`}>{point.batchDate}</Link>
                    </td>
                    <td>
                      <StatusBadge status={point.status} />
                    </td>
                    <td className="dash-num">
                      <Money fils={point.grossFils} />
                    </td>
                    <td className="dash-num">
                      <Money fils={point.feeFils} />
                    </td>
                    <td className="dash-num dash-cell-strong">
                      <Money fils={point.netPayoutFils} />
                    </td>
                    <td className="dash-nowrap">{dateTime(point.paidAt)}</td>
                  </tr>
                ))}
                {payouts && payouts.points.length === 0 ? (
                  <EmptyRow colSpan={6}>No settled batches in this window.</EmptyRow>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          labelledBy="overview-top-links"
          title="Top paid links"
          aside={
            topLinks ? <StalenessBadge readModelAsOf={topLinks.readModelAsOf} live={topLinks.live} /> : null
          }
        >
          <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>
                    <span className="dash-visually-hidden">Rank</span>#
                  </th>
                  <th>Reference</th>
                  <th className="dash-num">Amount</th>
                  <th className="dash-bar-cell">
                    <span className="dash-visually-hidden">Share of top link</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {topLinkRows.map((link, index) => (
                  <tr key={link.id}>
                    <td>
                      <span className={index === 0 ? "dash-rank dash-rank-1" : "dash-rank"}>{index + 1}</span>
                    </td>
                    <td>
                      <Link to={`/dashboard/payment-links/${link.id}`}>{dash(link.reference)}</Link>
                      <span className="dash-cell-sub">
                        {dash(link.description)} · Paid {dateTime(link.paidAt)}
                      </span>
                    </td>
                    <td className="dash-num dash-cell-strong">
                      <Money fils={link.amountFils} />
                    </td>
                    <td className="dash-bar-cell">
                      <span className="dash-bar-track">
                        <span
                          className={index === 0 ? "dash-bar dash-bar-gold" : "dash-bar"}
                          style={{ width: `${(link.amountFils / topLinkPeak) * 100}%` }}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
                {topLinks && topLinks.links.length === 0 ? (
                  <EmptyRow colSpan={4}>No paid payment links in this window.</EmptyRow>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </section>
  );
}
