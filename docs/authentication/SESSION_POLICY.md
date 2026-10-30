# Merchant session policy

A signed-in merchant dashboard session lasts **48 hours (172,800 seconds)**
from the moment the OTP is verified. The backend enforces this. The browser
cookie carries the same lifetime, but the cookie isn't what ends the session:
the API rejects the token once the database says it has expired.

This policy covers only merchant sessions (`apps/web` dashboard,
`/v1/auth/*`). Admin sessions, impersonation grants and public checkout are
separate and unchanged. See [Other sessions](#other-sessions).

## Lifetime

| Stage | Lifetime | Starts | Setting |
|---|---|---|---|
| Pending (password accepted, OTP not yet verified) | 10 minutes | Password step | `PENDING_SESSION_TTL_MINUTES` (default 10) |
| Authenticated | **48 hours** | OTP verification | `SESSION_TTL_HOURS` (default **48**, was 12) |

- **Absolute, not sliding.** Using the dashboard doesn't extend the session.
  It ends 48 hours after sign-in, however active the merchant is.
- **No idle timeout.** A session left unused for a day is still valid until
  its 48 hours are up.
- **Shared across tabs.** All tabs in one browser profile use the same cookie,
  so they share one session.

## How it works

1. **Password step** (`POST /v1/auth/login`): `createPendingSession` inserts a
   `sessions` row with `authenticated = false` and `expires_at = now + 10 min`.
   It also sets the cookie with `Max-Age=600`. A pending session grants
   nothing.
2. **OTP step** (`POST /v1/auth/otp/verify`): `promoteSession` sets
   `authenticated = true`, `authenticated_at = now()` and
   `expires_at = now + SESSION_TTL_HOURS`. The route then re-issues the same
   token with `Max-Age = SESSION_TTL_HOURS × 3600` (172,800).
3. **Every protected request**: `requireMerchantAuth` hashes the cookie token
   and looks it up through the `live_sessions` view (`revoked_at IS NULL AND
   expires_at > now()`). If no live row matches, the API answers `401`. The
   database clock decides expiry, not the browser.
4. **Logout** (`POST /v1/auth/logout`): `revokeSession` sets `revoked_at`, so
   the token stops working immediately. The response clears the cookie
   (`Max-Age=0`). A copy of the token kept anywhere else is also rejected.

The cookie holds only a random opaque token. The database stores its sha256
hash, never the token itself.

### Cookie

| Attribute | Value |
|---|---|
| Name | `fp_sid` (`COOKIE_NAME`) |
| `HttpOnly` | yes |
| `SameSite` | `Lax` |
| `Secure` | `COOKIE_SECURE`; on by default when `NODE_ENV=production` |
| `Path` | `/` |
| `Max-Age` | 600 while pending, 172,800 once authenticated, 0 on logout |

Extending the lifetime didn't change any of these security attributes.

## Frontend behaviour (`apps/web`)

- **On load**, `DashboardAuthProvider` calls `GET /v1/auth/me`. If that fails,
  `RequireDashboardAuth` redirects to `/dashboard/login` and remembers the
  page the merchant was on.
- **Mid-session expiry:** if a protected API call answers `401`, the API
  client dispatches a `filspay:session-expired` window event
  (`src/api/sessionExpiry.ts`). The auth context drops its state, which
  redirects to sign-in. The login page then shows "Your session has ended.
  Sign in again to continue."
- **401s that don't mean expiry:** sign-in, OTP, `/me`, logout and public
  checkout (`/v1/payment-links/*`) can all answer 401 for other reasons, so
  they never trigger the redirect.
- **Logout and first visits** don't show the "session ended" message.
- **Other tabs** notice the expiry on their next API request and redirect the
  same way.

## Other sessions

These are unaffected by this policy.

| Session | Lifetime | Setting |
|---|---|---|
| Admin console (`fp_admin_sid`, `admin_sessions`) | 8 hours | `ADMIN_SESSION_TTL_HOURS` |
| Admin pending (before OTP) | 10 minutes | `ADMIN_PENDING_SESSION_TTL_MINUTES` |
| Admin impersonation grant | 15 minutes | `IMPERSONATION_TTL_MINUTES` |
| Public checkout (`/pay/:token`) | no session; governed by the payment link's own expiry | n/a |

## Changing the lifetime

Set `SESSION_TTL_HOURS` in the API's environment and restart the API. The
change affects only sessions verified after the restart. An existing session
keeps the `expires_at` it was given at sign-in.

`ops/docker-compose.yml` doesn't pass `SESSION_TTL_HOURS`, so the Docker stack
uses the code default. After pulling this change, rebuild the API image so it
picks up the new default:

```sh
docker compose -f ops/docker-compose.yml up -d --build api
```

## Verification

- `apps/api/src/auth/sessionPolicy.new.test.ts` covers four things:
  - the default is 48 h (172,800 s);
  - the admin, pending and impersonation lifetimes are unchanged;
  - the environment override still works;
  - `promoteSession` sets `expires_at` exactly 172,800 s after a mocked "now".
- `apps/web/src/api/sessionExpiry.new.test.ts` checks which 401s count as
  session expiry.
- A local end-to-end run (2026-10-30) checked the following against an API
  built from this change. It made expiry happen by back-dating `expires_at`
  on its own test sessions, rather than waiting 48 hours:
  - **Cookie:** `Max-Age=172800` with the security attributes unchanged.
  - **Database:** `expires_at − authenticated_at = 172,800 s`, and requests
    don't move it.
  - **Dashboard use:** the session survives refresh, navigation and a second
    tab.
  - **Expiry:** returns `401` from the API and redirects to sign-in with the
    "session ended" message.
  - **Logout:** revokes the session at once.
  - **Admin and checkout:** admin still gets `Max-Age=28800`, and public
    checkout is unaffected.

## Known limitations

- Expiry is absolute. A merchant actively working at hour 47:59 is still
  signed out at hour 48. Moving to a sliding or idle timeout would be a
  separate policy decision.
- Sessions created before the change keep their original 12-hour expiry.
- There's no "sign out of all devices" feature for merchants. Each session
  ends on its own logout or expiry.
- A tab learns that the session has expired only on its next API request. No
  background timer signs it out at the exact moment of expiry.
