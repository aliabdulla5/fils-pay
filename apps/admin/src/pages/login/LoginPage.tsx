import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, verifyOtp } from "../../api/auth.js";
import { describeError } from "../../api/client.js";
import { useAdminAuth } from "../../auth/AdminAuthContext.js";
import { BrandMark, IconLock } from "../../components/icons.js";
import { ErrorMessage } from "../../components/ui.js";
import type { AdminLoginResponse } from "../../types.js";

type Step =
  | { kind: "credentials" }
  | { kind: "otp"; challenge: AdminLoginResponse };

/**
 * Two-step admin login: email + password creates a *pending* session
 * and issues an OTP challenge; the OTP step is what actually authenticates
 * it. Neither step is told which half of a bad credential pair was wrong —
 * the API answers a single generic `invalid_credentials`, and this screen
 * repeats it verbatim rather than guessing at something more specific.
 */
export function LoginPage() {
  const { status, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/merchants";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await login({ email, password });
      setStep({ kind: "otp", challenge });
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // YA: admin verify re-issues the cookie with the full TTL
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp({ code });
      // The session cookie is now authenticated server-side; re-read `me`
      // so the rest of the console renders from the server's answer, not
      // from the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const onOtpStep = step.kind === "otp";

  return (
    <main className="admin-auth">
      <div className="admin-brand">
        <BrandMark />
        <span className="admin-brand-name">FilsPay</span>
        <span className="admin-brand-tag">Admin</span>
      </div>

      <div className="admin-auth-card">
        <ol className="admin-steps" aria-label="Sign-in progress">
          <li
            className={onOtpStep ? "admin-step is-done" : "admin-step is-current"}
            aria-current={onOtpStep ? undefined : "step"}
          >
            Staff credentials
          </li>
          <li
            className={onOtpStep ? "admin-step is-current" : "admin-step"}
            aria-current={onOtpStep ? "step" : undefined}
          >
            Verification code
          </li>
        </ol>

        <div className="admin-auth-head">
          <h1>{onOtpStep ? "Check your code" : "Sign in to the admin console"}</h1>
          {step.kind === "otp" ? (
            <p>
              A one-time code was issued for <strong>{email}</strong>. It expires at{" "}
              {new Date(step.challenge.otpExpiresAt).toLocaleTimeString()}.
            </p>
          ) : (
            <p>Internal operations console.</p>
          )}
        </div>

        {error ? <ErrorMessage>{error}</ErrorMessage> : null}

        {step.kind === "credentials" ? (
          <form onSubmit={(e) => void handleCredentials(e)} className="admin-form">
            <label className="admin-field">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="admin-field">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="admin-button admin-button-primary admin-button-block"
              disabled={submitting}
            >
              {submitting ? "Signing in..." : "Continue"}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleOtp(e)} className="admin-form">
            {step.challenge.devOtpCode ? (
              <p className="admin-dev-code">
                Development code: <code>{step.challenge.devOtpCode}</code>
              </p>
            ) : null}
            <label className="admin-field">
              One-time code
              <input
                className="admin-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="admin-button admin-button-primary admin-button-block"
              disabled={submitting}
            >
              {submitting ? "Verifying..." : "Verify"}
            </button>
            <div>
              <button
                type="button"
                className="admin-linkbutton"
                onClick={() => {
                  setStep({ kind: "credentials" });
                  setCode("");
                  setError(null);
                }}
              >
                Start over
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="admin-auth-foot">
        <IconLock />
        Staff only. Every sign-in is confirmed with a one-time code.
      </p>
    </main>
  );
}
