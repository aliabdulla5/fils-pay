import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "../auth/DashboardAuthContext.js";
import { RequireRole } from "../auth/RequireRole.js";
import { describeError } from "../api/client.js";
import {
  BrandMark,
  IconChevronDown,
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

/** Up to two initials for the account avatar: "Alpha Retail Co" → "AR". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);

  // The small-screen menu closes whenever the route changes, and on Escape.
  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
  }, [location.pathname]);

  // The account menu closes on Escape (focus returns to its trigger) and on
  // any click outside it.
  useEffect(() => {
    if (!accountOpen) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountTriggerRef.current?.focus();
      }
    }
    function onPointer(event: MouseEvent): void {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [accountOpen]);

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

            {/* Account menu: the header only has room for a compact trigger, so
                the full merchant name and email live in the panel, where they
                wrap instead of being cut off. On small screens the panel is
                shown inline inside the open nav menu and the trigger is hidden. */}
            <div className={accountOpen ? "dash-account is-open" : "dash-account"} ref={accountRef}>
              <button
                type="button"
                className="dash-account-trigger"
                aria-expanded={accountOpen}
                aria-controls="dash-account-panel"
                aria-label={me ? `Account: ${me.merchant.displayName}, ${me.email}` : "Account"}
                ref={accountTriggerRef}
                onClick={() => setAccountOpen((open) => !open)}
              >
                <span className="dash-avatar" aria-hidden="true">
                  {me ? initials(me.merchant.displayName) : ""}
                </span>
                {me ? (
                  <>
                    <span className="dash-account-name">{me.merchant.displayName}</span>
                    <span className="dash-role-chip">{me.role}</span>
                  </>
                ) : null}
                <IconChevronDown />
              </button>

              <div className="dash-account-panel" id="dash-account-panel">
                {me ? (
                  <dl className="dash-account-details">
                    <dt className="dash-visually-hidden">Merchant</dt>
                    <dd className="dash-account-merchant">{me.merchant.displayName}</dd>
                    <dt className="dash-visually-hidden">Signed in as</dt>
                    <dd className="dash-account-email">{me.email}</dd>
                    <dt className="dash-visually-hidden">Role</dt>
                    <dd>
                      <span className="dash-role-chip">{me.role}</span>
                    </dd>
                  </dl>
                ) : null}
                <button
                  type="button"
                  className="dash-button dash-button-sm dash-account-logout"
                  onClick={() => void handleSignOut()}
                >
                  <IconLogout />
                  Log out
                </button>
              </div>
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
