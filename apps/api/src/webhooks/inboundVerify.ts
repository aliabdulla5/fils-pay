import { createHmac } from "node:crypto";
import { timingSafeEqualHex } from "../lib/crypto.js";

/** Verifies the signature on an inbound acquirer callback. */

interface ParsedAcquirerSignatureHeader {
  timestamp: number;
  signature: string;
}

function parseAcquirerSignatureHeader(header: string): ParsedAcquirerSignatureHeader | null {
  let timestampStr: string | null = null;
  let signature: string | null = null;

  for (const part of header.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === "t") timestampStr = value;
    else if (key === "v1") signature = value;
  }

  if (!timestampStr || !signature) return null;
  if (!/^\d+$/.test(timestampStr)) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;

  return { timestamp, signature };
}

export type VerifyAcquirerCallbackFailureReason = "malformed_header" | "signature_mismatch" | "stale_timestamp";

export interface VerifyAcquirerCallbackResult {
  valid: boolean;
  reason?: VerifyAcquirerCallbackFailureReason;
}

export interface VerifyFreshnessOptions {
  /** Reject a signature whose `t=` is further than this from now. */
  toleranceSeconds: number;
  nowSeconds?: number;
}

/**
 * Verifies the acquirer callback signature when present and required.
 * With `freshness`, a correctly-signed but old (or future) timestamp is
 * rejected too — otherwise a captured callback can be replayed forever.
 */
export function verifyAcquirerCallbackSignature(
  payload: unknown,
  header: string | undefined,
  secret: string,
  requireSignature = false,
  freshness?: VerifyFreshnessOptions,
): VerifyAcquirerCallbackResult {
  if (!header) {
    return requireSignature
      ? { valid: false, reason: "malformed_header" }
      : { valid: true };
  }

  const parsed = parseAcquirerSignatureHeader(header);
  if (!parsed) return { valid: false, reason: "malformed_header" };

  // A string payload is the raw request body, signed exactly as received.
  // Re-serializing the parsed body (JSON.stringify) only matches a sender
  // whose JSON has no whitespace, no escaped unicode and no number spellings
  // like 1.0, so a correctly signed callback could fail verification.
  const signedBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${signedBody}`)
    .digest("hex");

  // The old helper was named constantTimeEquals but used Buffer.compare,
  // which returns at the first differing byte.
  if (!timingSafeEqualHex(expected, parsed.signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  if (freshness) {
    const now = freshness.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - parsed.timestamp) > freshness.toleranceSeconds) {
      return { valid: false, reason: "stale_timestamp" };
    }
  }

  return { valid: true };
}
