/**
 * Detecting a merchant session that ended while the dashboard was open.
 *
 * The server is the only authority on session lifetime (48 h, enforced by
 * `live_sessions`; see docs/authentication/SESSION_POLICY.md). There is no
 * client-side timer: the dashboard learns that a session ended when a
 * protected request answers 401, and `DashboardAuthProvider` listens for
 * this event to drop its state so the route guard sends the merchant to
 * sign-in.
 *
 * Kept free of `import.meta.env` so it can be unit-tested under plain tsx.
 */
export const SESSION_EXPIRED_EVENT = "filspay:session-expired";

/** Paths whose 401 is NOT "your session ended":
 *  - sign-in steps answer 401 for a wrong password or code, which the
 *    sign-in page shows itself;
 *  - `/v1/auth/me` is how the provider detects an anonymous visitor on load;
 *  - `/v1/auth/logout` runs when the session is being ended on purpose;
 *  - the public checkout never carries a merchant session. */
const NOT_SESSION_EXPIRY_PREFIXES = [
  "/v1/auth/login",
  "/v1/auth/otp/",
  "/v1/auth/me",
  "/v1/auth/logout",
  "/v1/payment-links/",
];

export function isSessionExpiry(path: string, status: number): boolean {
  if (status !== 401) return false;
  return !NOT_SESSION_EXPIRY_PREFIXES.some((prefix) => path.startsWith(prefix));
}
