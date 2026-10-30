import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import {
  approveCreditRequest,
  listCreditRequests,
  rejectCreditRequest,
} from "../../api/credits.js";
import { describeError } from "../../api/client.js";
import { RequireRole } from "../../auth/RequireRole.js";
import { IconAlert } from "../../components/icons.js";
import {
  EmptyRow,
  ErrorMessage,
  Money,
  Notice,
  PageHeader,
  StatusBadge,
  statusLabel,
} from "../../components/ui.js";
import type { CreditRequestDto, CreditRequestStatus } from "../../types.js";

function bhd(fils: number): string {
  return `${formatBhd(toFils(fils, { allowNegative: true }))} BHD`;
}

const STATUS_TABS: Array<{ value: CreditRequestStatus; label: string }> = [
  { value: "pending_approval", label: "Awaiting approval" },
  { value: "posted", label: "Posted" },
  { value: "rejected", label: "Rejected" },
];

/**
 * The checker half of maker-checker: every credit waiting on a second
 * operator, plus the history of what was posted or declined.
 *
 * Approve and Reject are wrapped in `RequireRole` so a support operator
 * isn't shown a control that would answer 403 — the gate itself lives on the
 * route, server-side.
 */
// approve is gated server side but issuing (MerchantDetail) only in the ui? — am
// MK: both are server-side
export function CreditsPage() {
  const [status, setStatus] = useState<CreditRequestStatus>("pending_approval");
  const [items, setItems] = useState<CreditRequestDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [pendingReject, setPendingReject] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const page = await listCreditRequests({ status });
      setItems(page.items ?? []);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setLoadError(describeError(err));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    try {
      const page = await listCreditRequests({ status, cursor: nextCursor });
      setItems((current) => [...current, ...(page.items ?? [])]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setLoadError(describeError(err));
    }
  }

  async function handleApprove(id: string): Promise<void> {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      const record = await approveCreditRequest(id);
      setNotice(
        `Approved. ${bhd(record.postedAmountFils)} journaled to entry group ${
          record.ledgerEntryGroupId ?? "(unknown)"
        }.`,
      );
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string): Promise<void> {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await rejectCreditRequest(id, rejectReason.trim() ? rejectReason.trim() : undefined);
      setNotice("Credit request rejected. Nothing was journaled.");
      setPendingReject(null);
      setRejectReason("");
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  const rejecting = pendingReject ? items.find((item) => item.id === pendingReject) : undefined;

  return (
    <section className="admin-page">
      <PageHeader
        title="Merchant credits"
        description={
          <>
            Manual credits are journaled to <code>ledger_entries</code> like any other money movement.
            A credit above the approval limit cannot post until a second <code>finance</code> or{" "}
            <code>super_admin</code> operator — not the one who raised it — approves it.
          </>
        }
      />

      {loadError ? <ErrorMessage>{loadError}</ErrorMessage> : null}
      {actionError ? <ErrorMessage>{actionError}</ErrorMessage> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      {pendingReject ? (
        <div className="admin-confirm" role="alertdialog" aria-labelledby="reject-title">
          <span className="admin-confirm-title" id="reject-title">
            <IconAlert />
            Reject this credit request?
          </span>
          <p>
            {rejecting ? (
              <>
                <Money fils={rejecting.postedAmountFils} /> for merchant{" "}
                <code>{rejecting.merchantId.slice(0, 8)}</code>, requested by{" "}
                {rejecting.requestedByDisplayName}.{" "}
              </>
            ) : null}
            Nothing is journaled, and the request cannot be approved afterwards.
          </p>
          <label className="admin-field">
            <span className="admin-field-label">
              Reason <span className="admin-field-optional">Optional — recorded in the admin audit log</span>
            </span>
            <input
              type="text"
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </label>
          <div className="admin-actions">
            <button
              type="button"
              className="admin-button admin-button-danger-solid"
              disabled={busyId === pendingReject}
              onClick={() => void handleReject(pendingReject)}
            >
              Yes, reject it
            </button>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                setPendingReject(null);
                setRejectReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="admin-card">
        <div className="admin-toolbar">
          <div className="admin-segmented" role="group" aria-label="Credit status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={tab.value === status}
                onClick={() => {
                  if (tab.value !== status) setStatus(tab.value);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Requested by</th>
                <th>Merchant</th>
                <th>Reason</th>
                <th className="admin-num">Base</th>
                <th className="admin-num">Fee reversal</th>
                <th className="admin-num">Posted total</th>
                <th>Effective date</th>
                <th>Approved by</th>
                <th className="admin-num">
                  <span className="admin-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.id === pendingReject ? "is-selected" : undefined}>
                  <td>{item.requestedByDisplayName}</td>
                  <td>
                    <Link to={`/merchants/${item.merchantId}`}>
                      <code>{item.merchantId.slice(0, 8)}</code>
                    </Link>
                  </td>
                  <td>
                    {statusLabel(item.reasonCode)}
                    {item.memo ? <span className="admin-cell-sub">{item.memo}</span> : null}
                  </td>
                  <td className="admin-num">
                    <Money fils={item.baseAmountFils} />
                  </td>
                  <td className="admin-num">
                    {item.feeReversalFils > 0 ? <Money fils={item.feeReversalFils} /> : "-"}
                  </td>
                  <td className="admin-num admin-cell-strong">
                    <Money fils={item.postedAmountFils} />
                  </td>
                  <td className="admin-nowrap">{item.effectiveDate}</td>
                  <td>{item.approvedByDisplayName ?? "-"}</td>
                  <td className="admin-num">
                    {item.status === "pending_approval" ? (
                      <RequireRole
                        allow={["finance", "super_admin"]}
                        fallback={<span className="admin-muted">finance role required</span>}
                      >
                        <span className="admin-actions admin-actions-end">
                          <button
                            type="button"
                            className="admin-button admin-button-sm admin-button-primary"
                            disabled={busyId === item.id}
                            onClick={() => void handleApprove(item.id)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button-sm admin-button-danger"
                            disabled={busyId === item.id}
                            onClick={() => setPendingReject(item.id)}
                          >
                            Reject
                          </button>
                        </span>
                      </RequireRole>
                    ) : (
                      <StatusBadge status={item.status} />
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? <EmptyRow colSpan={9}>Nothing here.</EmptyRow> : null}
            </tbody>
          </table>
        </div>

        {nextCursor ? (
          <div className="admin-list-footer">
            <span>
              {items.length} request{items.length === 1 ? "" : "s"} loaded
            </span>
            <button type="button" className="admin-button admin-button-sm" onClick={() => void loadMore()}>
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
