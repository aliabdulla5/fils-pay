import type { Pool } from "pg";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { recordKycReviewInTx } from "../onboarding/review.js";

export interface BulkApproveMerchantsKycInput {
  merchantIds: string[];
  adminUserId: string;
  /** The reviewing admin's email — merchant_kyc_reviews.reviewer_identifier, as the single review writes it. */
  adminEmail: string;
  notes?: string;
}

/**
 * @property approvedMerchantIds Only merchants that moved from under_review to approved.
 * Already-approved or rejected ids are skipped and not listed.
 */
export interface BulkApproveMerchantsKycResult {
  approvedCount: number;
  approvedMerchantIds: string[];
}

/** Approves the given merchants and audits it. */
export async function bulkApproveMerchantsKyc(
  pool: Pool,
  input: BulkApproveMerchantsKycInput,
): Promise<BulkApproveMerchantsKycResult> {
  return withTransaction(pool, async (client) => {
    // Only merchants actually awaiting review. The bare UPDATE approved any
    // id it was given — a merchant KYC had *rejected* came back approved —
    // and wrote no merchant_kyc_reviews row, which 0016 makes the single
    // source of truth for every approval. Each one now goes through the one
    // function allowed to approve (the same as the single-merchant review).
    const pending = await client.query<{ id: string }>(
      `SELECT id FROM merchants
        WHERE id = ANY($1::uuid[]) AND onboarding_status = 'under_review'
        ORDER BY id
        FOR UPDATE`,
      [input.merchantIds],
    );
    const approvedMerchantIds: string[] = [];
    for (const row of pending.rows) {
      await recordKycReviewInTx(client, {
        merchantId: row.id,
        outcome: "approved",
        reviewerIdentifier: input.adminEmail,
        reviewerAdminUserId: input.adminUserId,
        notes: input.notes,
      });
      approvedMerchantIds.push(row.id);
    }

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "kyc_bulk_approve",
      targetType: "platform",
      targetId: null,
      metadata: {
        requestedMerchantIds: input.merchantIds,
        approvedMerchantIds,
        notes: input.notes ?? null,
      },
    });

    return { approvedCount: approvedMerchantIds.length, approvedMerchantIds };
  });
}
