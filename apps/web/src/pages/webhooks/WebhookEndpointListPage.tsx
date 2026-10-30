import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteWebhookEndpoint,
  listWebhookEndpoints,
  updateWebhookEndpoint,
} from "../../api/webhooks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { IconPlus } from "../../components/icons.js";
import { EmptyRow, ErrorMessage, Loading, PageHeader, StatusBadge } from "../../components/ui.js";
import { dateTime } from "../../format.js";
import type { WebhookEndpointDto } from "../../types.js";

/**
 * `GET /v1/merchants/:merchantId/webhook-endpoints`. Unlike most
 * list reads in this platform, this one is `owner`/`finance` only
 * server-side — so a `support` user reaching this page gets a real `403`,
 * which `describeError` renders plainly. The nav link is hidden from them too
 * (DashboardLayout), but a typed URL still lands here, and it must explain
 * itself rather than sit on a blank loading state.
 */
export function WebhookEndpointListPage() {
  const { me } = useDashboardAuth();
  const merchantId = me?.merchant.id;

  const [endpoints, setEndpoints] = useState<WebhookEndpointDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      setEndpoints(await listWebhookEndpoints(merchantId));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(endpoint: WebhookEndpointDto): Promise<void> {
    if (!merchantId) return;
    setBusyId(endpoint.id);
    setError(null);
    try {
      await updateWebhookEndpoint(merchantId, endpoint.id, {
        status: endpoint.status === "active" ? "disabled" : "active",
      });
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  // delete 500s if the endpoint has deliveries — am
  // MK: fixed in FP-240
  async function handleDelete(endpoint: WebhookEndpointDto): Promise<void> {
    if (!merchantId) return;
    // A hard delete — the endpoint row is gone, while its delivery log
    // outlives it. Irreversible, so it asks first.
    if (
      !window.confirm(
        `Delete ${endpoint.url}? This cannot be undone, and its secret cannot be recovered.`,
      )
    ) {
      return;
    }
    setBusyId(endpoint.id);
    setError(null);
    try {
      await deleteWebhookEndpoint(merchantId, endpoint.id);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="dash-page">
      <PageHeader
        title="Webhook endpoints"
        description="URLs FilsPay sends event notifications to. Every delivery is signed with the endpoint's secret."
        actions={
          <Link className="dash-button-link" to="/dashboard/webhooks/new">
            <IconPlus />
            New endpoint
          </Link>
        }
      />

      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <div className="dash-card">
        <div className="dash-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="dash-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Secret prefix</th>
                <th>Status</th>
                <th>Created</th>
                <th className="dash-num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((endpoint) => (
                <tr key={endpoint.id}>
                  <td className="dash-cell-url">
                    <Link to={`/dashboard/webhooks/${endpoint.id}`}>{endpoint.url}</Link>
                  </td>
                  <td>
                    <code>{endpoint.secretPrefix}</code>
                  </td>
                  <td>
                    <StatusBadge status={endpoint.status} />
                  </td>
                  <td className="dash-nowrap">{dateTime(endpoint.createdAt)}</td>
                  <td className="dash-num">
                    <span className="dash-actions dash-actions-end">
                      <button
                        type="button"
                        className="dash-button dash-button-sm"
                        disabled={busyId === endpoint.id}
                        onClick={() => void handleToggle(endpoint)}
                      >
                        {endpoint.status === "active" ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="dash-button dash-button-sm dash-button-danger"
                        disabled={busyId === endpoint.id}
                        onClick={() => void handleDelete(endpoint)}
                      >
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {endpoints.length === 0 && !loading && !error ? (
                <EmptyRow colSpan={5}>
                  No webhook endpoints registered.{" "}
                  <Link to="/dashboard/webhooks/new">Add your first endpoint</Link>
                </EmptyRow>
              ) : null}
            </tbody>
          </table>
        </div>

        {loading ? <Loading /> : null}
      </div>
    </section>
  );
}
