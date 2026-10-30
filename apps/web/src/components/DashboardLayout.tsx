import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "../auth/DashboardAuthContext.js";
import { RequireRole } from "../auth/RequireRole.js";
import { describeError } from "../api/client.js";
import {
  BrandMark,
  IconClose,
  IconLink,
  IconLogout,
  IconMenu,
  IconOverview,
  IconReconcile,
  IconSettlement,
  IconTransactions,
  IconWebhook,
} from "./icons.js";
import { ErrorMessage } from "./ui.js";
import "../dashboard.css";

/** Nav shell for every merchant dashboard screen. No impersonation banner
 *  here — nothing in the merchant plane impersonates anyone; when an admin
 *  "views as merchant", they arrive with a `support`-role session and see
 *  exactly what a support user sees. */
export function DashboardLayout() {
  const { me, signOut } = useDashboardAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // The small-screen menu closes whenever the route changes, and on Escape.
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

  // sign out clears the cookie server side, local merchantId stays — am
  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/dashboard/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="dash-shell">
      <header className={menuOpen ? "dash-header is-open" : "dash-header"}>
        <div className="dash-header-inner">
          <Link className="dash-brand" to="/dashboard/overview" aria-label="FilsPay dashboard home">
            <BrandMark />
            <span className="dash-brand-name">FilsPay</span>
          </Link>

          {me ? (
            <span className="dash-role-chip dash-role-chip-compact" aria-hidden="true">
              {me.role}
            </span>
          ) : null}

          <button
            type="button"
            className="dash-button dash-button-sm dash-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="dash-nav-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
            Menu
          </button>

          <div className="dash-nav-panel" id="dash-nav-panel">
            <nav className="dash-nav" aria-label="Dashboard">
              <NavLink to="/dashboard/overview">
                <IconOverview />
                Overview
              </NavLink>
              <NavLink to="/dashboard/transactions">
                <IconTransactions />
                Transactions
              </NavLink>
              <NavLink to="/dashboard/payment-links">
                <IconLink />
                Payment links
              </NavLink>
              {/* Every webhook route — including the plain list read — is
                  owner/finance-only server-side, so the link itself is
                  hidden from support rather than offered and then refused. */}
              <RequireRole allow={["owner", "finance"]}>
                <NavLink to="/dashboard/webhooks">
                  <IconWebhook />
                  Webhooks
                </NavLink>
              </RequireRole>
              <NavLink to="/dashboard/settlement">
                <IconSettlement />
                Settlement
              </NavLink>
              <RequireRole allow={["owner", "finance"]}>
                <NavLink to="/dashboard/reconciliation">
                  <IconReconcile />
                  Reconciliation
                </NavLink>
              </RequireRole>
            </nav>

            <div className="dash-identity">
              {me ? (
                <div className="dash-identity-text">
                  <span className="dash-identity-merchant">{me.merchant.displayName}</span>
                  <span className="dash-identity-email">
                    <span>{me.email}</span>
                    <span className="dash-role-chip">{me.role}</span>
                  </span>
                </div>
              ) : null}
              <button
                type="button"
                className="dash-button dash-button-sm"
                onClick={() => void handleSignOut()}
              >
                <IconLogout />
                Log out
              </button>
            </div>
          </div>
        </div>
      </header>

      {error ? (
        <div className="dash-header-error">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      ) : null}

      <main className="dash-main">
        <Outlet />
      </main>
    </div>
  );
}
