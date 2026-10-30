import { Link } from "react-router-dom";
import { BrandMark } from "../components/icons.js";
import "../dashboard.css";

/** Any URL no route matches. Replaces React Router's developer-facing
 *  default error screen; every existing route is unaffected. */
export function NotFoundPage() {
  return (
    <main className="dash-auth">
      <div className="dash-brand">
        <BrandMark />
        <span className="dash-brand-name">FilsPay</span>
      </div>
      <div className="dash-auth-card">
        <div className="dash-auth-head">
          <h1>Page not found</h1>
          <p>There&apos;s nothing at this address. Check the link, or head back to your dashboard.</p>
        </div>
        <Link className="dash-button-link dash-not-found-action" to="/dashboard">
          Go to your dashboard
        </Link>
      </div>
    </main>
  );
}
