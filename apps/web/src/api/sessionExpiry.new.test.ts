import assert from "node:assert/strict";
import test from "node:test";
import { isSessionExpiry } from "./sessionExpiry.js";

/** Which 401s mean "the merchant session ended" (redirect to sign-in) and
 *  which are ordinary answers the page handles itself. New file — existing
 *  test files are locked by repository rule. */

test("a 401 from a protected merchant endpoint means the session ended", () => {
  assert.equal(isSessionExpiry("/v1/transactions?limit=25", 401), true);
  assert.equal(isSessionExpiry("/v1/merchants/9972daab/payment-links", 401), true);
  assert.equal(isSessionExpiry("/v1/analytics/volumes", 401), true);
  assert.equal(isSessionExpiry("/v1/settlement/reconciliation?from=2026-10-01", 401), true);
});

test("sign-in, me, logout and public checkout 401s are not session expiry", () => {
  assert.equal(isSessionExpiry("/v1/auth/login", 401), false);
  assert.equal(isSessionExpiry("/v1/auth/otp/verify", 401), false);
  assert.equal(isSessionExpiry("/v1/auth/otp/resend", 401), false);
  assert.equal(isSessionExpiry("/v1/auth/me", 401), false);
  assert.equal(isSessionExpiry("/v1/auth/logout", 401), false);
  assert.equal(isSessionExpiry("/v1/payment-links/plink_abc/pay", 401), false);
});

test("other statuses never trigger a sign-out", () => {
  for (const status of [400, 402, 403, 404, 409, 410, 500, 502]) {
    assert.equal(isSessionExpiry("/v1/transactions", status), false);
  }
});
