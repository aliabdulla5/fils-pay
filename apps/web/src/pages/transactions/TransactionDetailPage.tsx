import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  captureTransaction,
  getTransaction,
  getTransactionEvents,
  voidTransaction,
} from "../../api/transactions.js";
import { ApiError, describeError } from "../../api/client.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { Card, ErrorMessage, Loading, Money, PageHeader, StatusBadge, statusLabel } from "../../components/ui.js";
import { dash, dateTime } from "../../format.js";
import type { TransactionDto, TransactionEventDto } from "../../types.js";
import { RefundDrawer } from "./RefundDrawer.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; txn: TransactionDto };

/**
 * `GET /v1/transactions/:id` plus its event timeline on the same page — one
 * feature, so one view, not two navigable routes.
 *
 * A `404` renders a plain "not found" state and never tries to distinguish
 * "doesn't exist" from "not yours": the API deliberately answers the same way
 * for both (a `403` would confirm a foreign transaction's existence), and
 * this page does not undo that by guessing.
 */
export function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [events, setEvents] = useState<TransactionEventDto[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureAmount, setCaptureAmount] = useState("");

  const load = useCallback(async () => {
    if (!id) {
      setState({ kind: "not_found" });
      return;
    }
    try {
      // Two independent reads — the events route does its own merchant-scoped
      // existence check, so neither depends on the other's result.
      const [txn, timeline] = await Promise.all([getTransaction(id), getTransactionEvents(id)]);
      setState({ kind: "loaded", txn });
      setEvents(timeline);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        setState({ kind: "not_found" });
      } else {
        setState({ kind: "error", message: describeError(err) });
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCapture(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!id) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const trimmed = captureAmount.trim();
      // Left blank, `amountFils` is omitted entirely and capture.ts captures
      // everything still outstanding — its own documented default. Computing
      // the remainder here would just be a second, staler copy of that rule.
      const input = trimmed === "" ? {} : { amountFils: Number(trimmed) };
      // A fresh Idempotency-Key per click, including a retry after a decline —
      // same discipline as the checkout page's submit handler.
      await captureTransaction(id, input, crypto.randomUUID());
      setCaptureOpen(false);
      setCaptureAmount("");
      // Refetch rather than patch: a capture wrote a new transaction_events
      // row server-side, so the timeline is stale, not merely shorter.
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  /** Only offered while status is authorized. */
  async function handleVoid(): Promise<void> {
    if (!id) return;
    if (!window.confirm("Void this authorization? The held funds are released and cannot be captured afterwards.")) {
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      // An already-voided transaction also answers `200` with the voided row —
      // indistinguishable from a first void on the wire, and correctly so:
      // both mean "now voided".
      await voidTransaction(id);
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const back = { to: "/dashboard/transactions", label: "Transactions" };

  if (state.kind === "loading") {
    return <Loading />;
  }
  if (state.kind === "not_found") {
    return (
      <section className="dash-page">
        <PageHeader back={back} title="Transaction not found" />
        <div className="dash-card dash-empty">
          <p>No transaction with this id exists on your account.</p>
          <Link to="/dashboard/transactions">Back to transactions</Link>
        </div>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section className="dash-page">
        <PageHeader back={back} title="Transaction" />
        <ErrorMessage>{state.message}</ErrorMessage>
      </section>
    );
  }

  const { txn } = state;
  const capturable = txn.status === "authorized" || txn.status === "partially_captured";
  const voidable = txn.status === "authorized";

  return (
    <section className="dash-page">
      <PageHeader
        back={back}
        title="Transaction"
        badge={<StatusBadge status={txn.status} />}
        description={<code>{txn.id}</code>}
        actions={
          <>
            {/* Capture and void are hidden from `support` as a UX choice — a support
                agent looks things up, they don't move money. Unlike the
                reconciliation page, this hide is NOT backed by a matching
                server-side role check: the API gates capture/void at "any
                authenticated merchant actor". Do not mistake a hidden button here for a security
                boundary. */}
            <RequireRole allow={["owner", "finance"]}>
              {capturable && !captureOpen ? (
                <button
                  type="button"
                  className="dash-button dash-button-primary"
                  onClick={() => setCaptureOpen(true)}
                >
                  Capture
                </button>
              ) : null}
              {voidable ? (
                <button
                  type="button"
                  className="dash-button dash-button-danger"
                  disabled={submitting}
                  onClick={() => void handleVoid()}
                >
                  Void
                </button>
              ) : null}
            </RequireRole>
            <RefundDrawer txn={txn} onRefunded={load} />
          </>
        }
      />

      <RequireRole allow={["owner", "finance"]}>
        {(capturable || voidable) && actionError ? <ErrorMessage>{actionError}</ErrorMessage> : null}

        {capturable && captureOpen ? (
          <Card title="Capture funds" labelledBy="capture-title">
            <form className="dash-card-body dash-form dash-form-inline" onSubmit={(e) => void handleCapture(e)}>
              <label className="dash-field dash-field-grow">
                Amount in fils
                <span className="dash-input-affix">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    autoFocus
                    value={captureAmount}
                    onChange={(e) => setCaptureAmount(e.target.value)}
                    aria-describedby="capture-amount-hint"
                  />
                  <span className="dash-input-suffix">fils</span>
                </span>
                <span className="dash-field-hint" id="capture-amount-hint">
                  Leave blank to capture everything outstanding.
                </span>
              </label>
              <div className="dash-actions">
                <button type="submit" className="dash-button dash-button-primary" disabled={submitting}>
                  {submitting ? "Capturing..." : "Capture"}
                </button>
                <button
                  type="button"
                  className="dash-button"
                  disabled={submitting}
                  onClick={() => setCaptureOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </Card>
        ) : null}
      </RequireRole>

      <div className="dash-grid-detail">
        <div className="dash-stack">
          <div className="dash-card">
            <div className="dash-hero">
              <div>
                <span className="dash-hero-label">Captured</span>
                <Money fils={txn.capturedFils} size="xl" />
              </div>
            </div>
            <div className="dash-figures">
              <div className="dash-figure">
                <span className="dash-figure-label">Authorized amount</span>
                <span className="dash-figure-value">
                  <Money fils={txn.amountFils} />
                </span>
              </div>
              <div className="dash-figure">
                <span className="dash-figure-label">Captured amount</span>
                <span className="dash-figure-value">
                  <Money fils={txn.capturedFils} />
                </span>
              </div>
              <div className="dash-figure">
                <span className="dash-figure-label">Refunded amount</span>
                <span className="dash-figure-value">
                  <Money fils={txn.refundedFils} />
                </span>
              </div>
            </div>
          </div>

          <Card title="Event timeline" labelledBy="timeline-title">
            {/* Already ordered oldest-first by the endpoint — never re-sorted
                here, so the page can't disagree with the API about history. */}
            {events.length > 0 ? (
              <ol className="dash-timeline">
                {events.map((event) => (
                  <li key={event.id} className="dash-timeline-item">
                    <span className="dash-timeline-dot" aria-hidden="true" />
                    <span className="dash-timeline-title">{statusLabel(event.eventType)}</span>
                    <span className="dash-timeline-amount">
                      {event.amountFils === null ? "—" : <Money fils={event.amountFils} />}
                    </span>
                    <span className="dash-timeline-meta">
                      {dateTime(event.occurredAt)} · {event.actorType}
                      {event.actorId ? (
                        <>
                          {" "}
                          <code>{event.actorId}</code>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dash-card-body dash-muted">No events recorded.</p>
            )}
          </Card>
        </div>

        <Card title="Details" labelledBy="details-title">
          <div className="dash-card-body">
            <dl className="dash-dl dash-dl-stacked">
              <dt>Status</dt>
              <dd>
                <StatusBadge status={txn.status} />
              </dd>
              <dt>Currency</dt>
              <dd>{txn.currency}</dd>
              <dt>Reference</dt>
              <dd>{dash(txn.reference)}</dd>
              <dt>Acquirer reference</dt>
              <dd>
                <code>{txn.acquirerReference}</code>
              </dd>
              <dt>Occurred at</dt>
              <dd>{dateTime(txn.occurredAt)}</dd>
              <dt>Created at</dt>
              <dd>{dateTime(txn.createdAt)}</dd>
            </dl>
          </div>
        </Card>
      </div>
    </section>
  );
}
