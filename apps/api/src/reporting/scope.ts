import type { Pool } from "pg";

export async function resolveReportMerchantId(
  pool: Pool,
  callerMerchantId: string,
  requestedMerchantId?: string,
): Promise<string> {
  if (!requestedMerchantId || requestedMerchantId === callerMerchantId) {
    return callerMerchantId;
  }

  // Only the caller's own split children. Matching on child_merchant_id
  // alone let any merchant read the transactions of every sub-merchant of
  // every marketplace by putting that child's id in the report filter.
  const result = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM merchant_split_children WHERE parent_merchant_id = $1 AND child_merchant_id = $2`,
    [callerMerchantId, requestedMerchantId],
  );
  if (result.rows.length === 0) {
    return callerMerchantId;
  }
  return requestedMerchantId;
}
