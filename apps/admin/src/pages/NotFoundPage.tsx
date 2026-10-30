import { Link } from "react-router-dom";
import { BrandMark } from "../components/icons.js";

/** Any URL no route matches. Replaces React Router's developer-facing
 *  default error screen; every existing route is unaffected. */
export function NotFoundPage() {
  return (
    <main className="admin-auth">
      <div className="admin-brand">
        <BrandMark />
        <span className="admin-brand-name">FilsPay</span>
        <span className="admin-brand-tag">Admin</span>
      </div>
      <div className="admin-auth-card">
        <div className="admin-auth-head">
          <h1>Page not found</h1>
          <p>There&apos;s no admin screen at this address.</p>
        </div>
        <Link className="admin-button-link admin-button-block" to="/merchants">
          Go to merchants
        </Link>
      </div>
    </main>
  );
}
