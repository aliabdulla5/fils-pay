import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { loadConfig } from "../config.js";
import { promoteSession } from "./sessions.js";

/**
 * Merchant session policy: 48 hours (172,800 s) from OTP verification,
 * enforced server-side (sessions.expires_at, read through live_sessions).
 * See docs/authentication/SESSION_POLICY.md. New file — existing test files
 * are locked by repository rule.
 */

const BASE_ENV = { DATABASE_URL: "postgres://unused/unused", NODE_ENV: "development" } as NodeJS.ProcessEnv;

test("merchant session lifetime defaults to 48 hours", () => {
  const config = loadConfig({ ...BASE_ENV });
  assert.equal(config.sessionTtlHours, 48);
  assert.equal(config.sessionTtlHours * 3_600, 172_800, "cookie Max-Age is sessionTtlHours * 3600");
});

test("admin, pending-session and impersonation lifetimes are unchanged", () => {
  const config = loadConfig({ ...BASE_ENV });
  assert.equal(config.adminSessionTtlHours, 8);
  assert.equal(config.pendingSessionTtlMinutes, 10);
  assert.equal(config.adminPendingSessionTtlMinutes, 10);
  assert.equal(config.impersonationTtlMinutes > 0, true);
});

test("SESSION_TTL_HOURS still overrides the default", () => {
  assert.equal(loadConfig({ ...BASE_ENV, SESSION_TTL_HOURS: "24" }).sessionTtlHours, 24);
});

test("promoteSession sets expires_at exactly 172,800 s after verification", async (t) => {
  const now = Date.parse("2026-10-30T09:00:00.000Z");
  t.mock.timers.enable({ apis: ["Date"], now });

  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const fakeClient = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;

  const expiresAt = await promoteSession(fakeClient, "session-1", loadConfig({ ...BASE_ENV }).sessionTtlHours);

  assert.equal(expiresAt.getTime() - now, 172_800_000);
  assert.equal(expiresAt.toISOString(), "2026-11-01T09:00:00.000Z");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /authenticated = true/);
  assert.deepEqual(calls[0]!.params, ["session-1", expiresAt]);
});
