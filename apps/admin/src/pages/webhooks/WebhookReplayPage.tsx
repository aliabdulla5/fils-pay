import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getMerchant, listMerchants } from "../../api/merchants.js";
import { replayBatch } from "../../api/webhooks.js";
import { describeError } from "../../api/client.js";
import { IconChevronLeft, IconSearch } from "../../components/icons.js";
import {
  Card,
  EmptyRow,
  ErrorMessage,
  Notice,
  PageHeader,
  StatusBadge,
  statusLabel,
} from "../../components/ui.js";
import type {
  AdminMerchantDetail,
  AdminMerchantSummary,
  BatchReplayResult,
  WebhookDeliveryStatus,
} from "../../types.js";

const REPLAYABLE_STATUSES: WebhookDeliveryStatus[] = [
  "exhausted",
  "failed",
  "pending",
  "succeeded",
];

/** `<input type="datetime-local">` wants a local-time `YYYY-MM-DDTHH:mm`
 *  string; the API wants ISO-8601 instants. Convert at both edges rather
 *  than making the operator think about timezones. */
function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

// default window is local time — am
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: toLocalInputValue(weekAgo), to: toLocalInputValue(now) };
}

/**
 * Replay every delivery for one endpoint inside a date range. Any
 * admin role: it is routine, reversible, and deduped receiver-side by the
 * delivery id, so no money moves as a direct result.
 */
export function WebhookReplayPage() {
  const { merchantId } = useParams<{ merchantId?: string }>();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AdminMerchantSummary[]>([]);
  const [detail, setDetail] = useState<AdminMerchantDetail | null>(null);

  const [endpointId, setEndpointId] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [statuses, setStatuses] = useState<WebhookDeliveryStatus[]>(["exhausted"]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchReplayResult | null>(null);

  const loadMerchant = useCallback(async () => {
    if (!merchantId) {
      setDetail(null);
      return;
    }
    setError(null);
    try {
      const loaded = await getMerchant(merchantId);
      setDetail(loaded);
      const firstActive = (loaded.webhookEndpoints ?? []).find((e) => e.status === "active");
      setEndpointId(firstActive?.id ?? "");
    } catch (err) {
      setError(describeError(err));
    }
  }, [merchantId]);

  useEffect(() => {
    void loadMerchant();
  }, [loadMerchant]);

  async function handleSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const found = await listMerchants({ q: search.trim() || undefined, limit: 10 });
      setCandidates(found.merchants ?? []);
    } catch (err) {
      setError(describeError(err));
    }
  }

  function toggleStatus(status: WebhookDeliveryStatus): void {
    setStatuses((previous) =>
      previous.includes(status) ? previous.filter((s) => s !== status) : [...previous, status],
    );
  }

  /** Replays keep the original Webhook-Delivery-Id so receivers can dedupe. */
  async function handleReplay(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!merchantId || !endpointId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await replayBatch(merchantId, endpointId, {
          from: new Date(range.from).toISOString(),
          to: new Date(range.to).toISOString(),
          statuses: statuses.length > 0 ? statuses : undefined,
        }),
      );
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!merchantId) {
    return (
      <section className="admin-page">
        <PageHeader
          title="Webhook replay"
          description="Pick the merchant whose endpoint needs a replay. Any admin role can replay: deliveries keep their original id, so receivers dedupe them."
        />
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <div className="admin-card">
          <form className="admin-toolbar" onSubmit={(e) => void handleSearch(e)}>
            <label className="admin-field admin-field-grow">
              Search merchants
              <span className="admin-input-affix">
                <IconSearch />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Display name, merchant id, or contact email"
                />
              </span>
            </label>
            <button type="submit" className="admin-button admin-button-primary">
              Search
            </button>
          </form>
          {candidates.length > 0 ? (
            <ul className="admin-picker">
              {candidates.map((merchant) => (
                <li key={merchant.id}>
                  <button type="button" onClick={() => navigate(`/webhooks/${merchant.id}`)}>
                    <span>
                      <strong>{merchant.displayName}</strong>
                      <code className="admin-muted">{merchant.id}</code>
                    </span>
                    <span className="admin-picker-arrow">
                      <IconChevronLeft />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty">Search to list merchants, then pick one to replay its deliveries.</p>
          )}
        </div>
      </section>
    );
  }

  const endpoints = detail?.webhookEndpoints ?? [];
  const replayedIds = result?.replayedDeliveryIds ?? [];

  return (
    <section className="admin-page">
      <PageHeader
        back={{ to: "/webhooks", label: "Pick a different merchant" }}
        title="Webhook replay"
        description={
          <>
            Merchant:{" "}
            {detail ? (
              <Link to={`/merchants/${merchantId}`}>{detail.merchant.displayName}</Link>
            ) : (
              <code>{merchantId}</code>
            )}
          </>
        }
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <div className="admin-grid-detail">
        <Card
          title="Replay a batch"
          id="replay-form"
          aside={
            busy ? (
              <span className="admin-badge admin-badge-warning admin-badge-processing">Processing</span>
            ) : null
          }
        >
          <div className="admin-card-body">
            {detail && endpoints.length === 0 ? (
              <p className="admin-info">This merchant has no webhook endpoints registered.</p>
            ) : null}

            <form className="admin-form" onSubmit={(e) => void handleReplay(e)}>
              <label className="admin-field">
                Endpoint
                <select value={endpointId} onChange={(e) => setEndpointId(e.target.value)} required>
                  <option value="" disabled>
                    Select an endpoint
                  </option>
                  {endpoints.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.url} ({endpoint.status})
                    </option>
                  ))}
                </select>
              </label>
              <div className="admin-form-row">
                <label className="admin-field">
                  From
                  <input
                    type="datetime-local"
                    required
                    value={range.from}
                    onChange={(e) => setRange({ ...range, from: e.target.value })}
                  />
                </label>
                <label className="admin-field">
                  To
                  <input
                    type="datetime-local"
                    required
                    value={range.to}
                    onChange={(e) => setRange({ ...range, to: e.target.value })}
                  />
                </label>
              </div>
              <fieldset className="admin-filters">
                <legend>Delivery statuses to replay</legend>
                {REPLAYABLE_STATUSES.map((status) => (
                  <label key={status} className="admin-chip">
                    <input
                      type="checkbox"
                      checked={statuses.includes(status)}
                      onChange={() => toggleStatus(status)}
                    />
                    {statusLabel(status)}
                  </label>
                ))}
              </fieldset>
              <p className="admin-field-hint">
                Defaults to <code>exhausted</code> — the one terminal failure state the dispatcher
                produces. Replaying a <code>succeeded</code> delivery is allowed but resends an event
                the receiver already accepted.
              </p>
              <div>
                <button
                  type="submit"
                  className={busy ? "admin-button admin-button-primary admin-button-busy" : "admin-button admin-button-primary"}
                  disabled={busy || !endpointId}
                >
                  {busy ? "Replaying..." : "Replay batch"}
                </button>
              </div>
            </form>
          </div>
        </Card>

        <Card title="Endpoints" id="replay-endpoints">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id} className={endpoint.id === endpointId ? "is-selected" : undefined}>
                    <td>
                      {endpoint.url}
                      <span className="admin-cell-sub">
                        <code>{endpoint.secretPrefix}</code>
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={endpoint.status} />
                    </td>
                  </tr>
                ))}
                {endpoints.length === 0 ? <EmptyRow colSpan={2}>No endpoints registered.</EmptyRow> : null}
              </tbody>
            </table>
          </div>
          <div className="admin-card-body">
            <p className="admin-section-label">Delivery statuses</p>
            <dl className="admin-dl">
              <dt>
                <StatusBadge status="pending" />
              </dt>
              <dd>Queued, or waiting for its next retry.</dd>
              <dt>
                <StatusBadge status="succeeded" />
              </dt>
              <dd>The receiver accepted it.</dd>
              <dt>
                <StatusBadge status="exhausted" />
              </dt>
              <dd>Retries ran out — the terminal failure state. Not sent again unless replayed.</dd>
              <dt>
                <StatusBadge status="failed" />
              </dt>
              <dd>A valid status in the schema that the dispatcher does not currently write.</dd>
            </dl>
          </div>
        </Card>
      </div>

      {result ? (
        <Card
          title="Replay queued"
          id="replay-result"
          aside={<StatusBadge status="pending" label={`${replayedIds.length} queued`} />}
        >
          <div className="admin-card-body">
            <Notice>
              Matched {result.matchedCount} deliver{result.matchedCount === 1 ? "y" : "ies"}; queued{" "}
              {replayedIds.length} replay
              {replayedIds.length === 1 ? "" : "s"}. They are sent by the normal async dispatcher pass,
              not immediately by this request.
            </Notice>
          </div>
          {replayedIds.length > 0 ? (
            <ul className="admin-id-list">
              {replayedIds.map((id) => (
                <li key={id}>
                  <code>{id}</code>
                  <StatusBadge status="pending" label="Queued" />
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
