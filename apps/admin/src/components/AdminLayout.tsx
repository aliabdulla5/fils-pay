import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthContext.js";
import { describeError, WEB_BASE_URL } from "../api/client.js";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import {
  BrandMark,
  IconClose,
  IconCredit,
  IconExternal,
  IconImport,
  IconLogout,
  IconMenu,
  IconMerchants,
  IconPause,
  IconSettlement,
  IconWebhook,
} from "./icons.js";
import { ErrorMessage } from "./ui.js";

/** Nav shell for every admin-plane screen: who you are signed in as, the
 *  section links, a logout, and — above all of it — the impersonation
 *  banner when a grant is live. */
// YA: nav order per Huda's request (Credits first)
export function AdminLayout() {
  const { admin, signOut, impersonation, exitImpersonation } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exiting, setExiting] = useState(false);

  // The small-screen menu closes on route change and on Escape.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  /** The same exit the banner offers — `exitImpersonation` from the auth
   *  context, nothing more. */
  async function handlePausedExit(): Promise<void> {
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

  const merchantLabel = impersonation ? (impersonation.merchantDisplayName ?? impersonation.merchantId) : null;

  return (
    <div className="admin-shell">
      <div className="admin-top">
        <ImpersonationBanner />

        <header className={menuOpen ? "admin-header is-open" : "admin-header"}>
          <div className="admin-header-inner">
            <Link className="admin-brand" to="/merchants" aria-label="FilsPay Admin home">
              <BrandMark />
              <span className="admin-brand-name">FilsPay</span>
              <span className="admin-brand-tag">Admin</span>
            </Link>

            {admin ? (
              <span className="admin-role-chip admin-role-chip-compact" aria-hidden="true">
                {admin.role}
              </span>
            ) : null}

            <button
              type="button"
              className="admin-button admin-button-sm admin-menu-toggle"
              aria-expanded={menuOpen}
              aria-controls="admin-nav-panel"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <IconClose /> : <IconMenu />}
              Menu
            </button>

            <div className="admin-nav-panel" id="admin-nav-panel">
              {impersonation ? (
                // While a grant is live the console is paused, so its section
                // links are withdrawn rather than offered and then blocked.
                <span className="admin-nav-paused">
                  <IconPause />
                  Admin navigation paused
                </span>
              ) : (
                <nav className="admin-nav" aria-label="Admin">
                  <NavLink to="/merchants">
                    <IconMerchants />
                    Merchants
                  </NavLink>
                  <NavLink to="/credits">
                    <IconCredit />
                    Credits
                  </NavLink>
                  <NavLink to="/settlement">
                    <IconSettlement />
                    Settlement ops
                  </NavLink>
                  <NavLink to="/adjustment-imports">
                    <IconImport />
                    Import adjustments
                  </NavLink>
                  <NavLink to="/webhooks">
                    <IconWebhook />
                    Webhook replay
                  </NavLink>
                </nav>
              )}

              <div className="admin-identity">
                {admin ? (
                  <>
                    <span className="admin-identity-email">{admin.email}</span>
                    <span className="admin-role-chip">{admin.role}</span>
                  </>
                ) : null}
                <button
                  type="button"
                  className="admin-button admin-button-sm"
                  onClick={() => void handleSignOut()}
                >
                  <IconLogout />
                  Log out
                </button>
              </div>
            </div>
          </div>
        </header>
      </div>

      {error ? (
        <div className="admin-shell-error">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      {impersonation ? (
        // An explicit "exit view-as-merchant" action is required before
        // admin-plane screens are shown again. This is a UX safeguard so the
        // two modes are never confused on screen; the privilege boundary
        // itself does not depend on it — /v1/admin/* never reads the
        // impersonation cookie, and the merchant side never reads the admin
        // session cookie.
        <main className="admin-paused" aria-labelledby="admin-paused-title">
          <div className="admin-paused-card">
            <div className="admin-paused-head">
              <span className="admin-paused-icon">
                <IconPause />
              </span>
              <div>
                <h1 id="admin-paused-title">Admin screens are paused</h1>
                <p>
                  You are viewing the merchant dashboard as <strong>{merchantLabel}</strong>. The admin
                  console stays paused until you exit, so the two modes are never confused on screen.
                </p>
              </div>
            </div>

            <dl className="admin-dl admin-paused-facts">
              <dt>Merchant</dt>
              <dd>
                {merchantLabel}
                <span className="admin-cell-sub">
                  <code>{impersonation.merchantId}</code>
                </span>
              </dd>
              <dt>Acting as</dt>
              <dd>The merchant&apos;s least-privileged support role</dd>
              <dt>Grant expires</dt>
              <dd>{new Date(impersonation.expiresAt).toLocaleString()}</dd>
              <dt>Grant id</dt>
              <dd>
                <code>{impersonation.grantId}</code>
              </dd>
            </dl>

            <ol className="admin-paused-steps">
              <li>
                Merchant screens are at <code>{WEB_BASE_URL}</code> while the grant lasts.
              </li>
              <li>
                Use <strong>Exit impersonation</strong> to end it and return to the admin console.
              </li>
            </ol>

            <div className="admin-paused-actions">
              <button
                type="button"
                className="admin-button admin-button-primary"
                disabled={exiting}
                onClick={() => void handlePausedExit()}
              >
                {exiting ? "Exiting..." : "Exit impersonation"}
              </button>
              <a className="admin-button" href={WEB_BASE_URL} target="_blank" rel="noreferrer">
                <IconExternal />
                Open merchant dashboard
              </a>
            </div>
          </div>
        </main>
      ) : (
        <main className="admin-main">
          <Outlet />
        </main>
      )}
    </div>
  );
}
