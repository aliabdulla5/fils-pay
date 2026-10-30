import { useEffect, useState } from "react";
import { useAdminAuth } from "../auth/AdminAuthContext.js";
import { describeError } from "../api/client.js";
import { IconEye } from "./icons.js";

/**
 * Shown on every admin screen for as long as an impersonation grant is
 * active. Impersonation is a real, privilege-adjacent state, so the
 * one thing this banner must never do is be easy to miss — it sits above
 * the nav, it is loud, and it carries its own one-click exit.
 *
 * The exit action calls `POST /v1/admin/impersonation/:grantId/end`, which
 * stamps `ended_at`, writes the closing audit row, and clears the
 * `fp_impersonation` cookie. Note what ending does *not* do: it does not
 * restore any admin privilege, because none was ever given up — `/v1/admin/*`
 * never reads anything impersonation-related. It closes the
 * merchant-read window and completes the audit trail.
 */
// MK: banner wording is accurate, impersonation is view-only
export function ImpersonationBanner() {
  const { impersonation, exitImpersonation } = useAdminAuth();
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Display only: re-renders the "minutes left" line. The grant's real
  // lifetime is enforced server-side, and the auth context drops the record
  // itself once expiresAt passes.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!impersonation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [impersonation]);

  if (!impersonation) return null;

  async function handleExit(): Promise<void> {
    setExiting(true);
    setError(null);
    try {
      await exitImpersonation();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setExiting(false);
    }
  }

  const label = impersonation.merchantDisplayName ?? impersonation.merchantId;
  const minutesLeft = Math.max(0, Math.ceil((Date.parse(impersonation.expiresAt) - now) / 60_000));

  return (
    <div className="impersonation-banner" role="alert">
      <div className="impersonation-banner-inner">
        <span className="impersonation-live">
          <IconEye />
          Impersonation active
        </span>
        <div className="impersonation-text">
          <strong>You are viewing as a merchant: </strong>
          <span className="impersonation-merchant">{label}</span>
          <span className="impersonation-meta">
            Active grant for <code>{label}</code>, expiring{" "}
            {new Date(impersonation.expiresAt).toLocaleString()} ({minutesLeft} min left). Merchant
            screens in the dashboard are acting with this merchant&apos;s least-privileged (support)
            role.
          </span>
        </div>
        <button type="button" className="admin-button" onClick={() => void handleExit()} disabled={exiting}>
          {exiting ? "Exiting..." : "Exit impersonation"}
        </button>
        {error ? <div className="impersonation-banner-error">Could not end it: {error}</div> : null}
      </div>
    </div>
  );
}
