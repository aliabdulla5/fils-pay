import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import { sha256Hex } from "../lib/crypto.js";
import { UnauthorizedError } from "../lib/errors.js";

/** Resolved from key_hash; never contains the raw key. */
export interface ApiKeyContext {
  merchantId: string;
  apiKeyId: string;
}

/** For later routes that should accept API-key auth instead of (or in
 *  addition to) a browser session, e.g. merchant-facing (non-dashboard) API
 *  endpoints. */
// MK: revoked_at IS NULL is in the query, so a revoke is instant
//
// Rotation (admin/apiKeys.ts) issues a replacement but leaves the old key
// unrevoked so the merchant can switch over — and nothing ever ended that
// overlap: a key rotated because it leaked kept working forever. A key that
// has been superseded by a rotation stops authenticating once the
// replacement is older than the grace window.
const ROTATION_GRACE = "24 hours";

export async function verifyApiKey(pool: Pool, rawKey: string): Promise<ApiKeyContext | null> {
  const keyHash = sha256Hex(rawKey);
  const result = await pool.query<{ id: string; merchant_id: string }>(
    `SELECT k.id, k.merchant_id
       FROM api_keys k
      WHERE k.key_hash = $1
        AND k.revoked_at IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM api_keys r
               WHERE r.rotated_from_key_id = k.id
                 AND r.created_at < now() - $2::interval
            )`,
    [keyHash, ROTATION_GRACE],
  );
  const row = result.rows[0];
  if (!row) return null;

  // Fire-and-forget: don't let a `last_used_at` write failure ever block or
  // fail the request it's merely instrumenting.
  void pool
    .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id])
    .catch(() => {});

  return { merchantId: row.merchant_id, apiKeyId: row.id };
}

export const requireApiKey: preHandlerHookHandler = async (request: FastifyRequest): Promise<void> => {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("unauthenticated");
  }
  const rawKey = header.slice("Bearer ".length);
  const context = await verifyApiKey(request.server.db, rawKey);
  if (!context) {
    throw new UnauthorizedError("unauthenticated");
  }
  request.apiKeyAuth = context;
};
