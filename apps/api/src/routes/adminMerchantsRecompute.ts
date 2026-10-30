import type { FastifyInstance } from "fastify";
import { requireAdminRole, requireAdminSession } from "../adminAuth/middleware.js";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { merchantExists, UUID_RE } from "../admin/merchants.js";
import { recomputeTransactionStatusesForMerchant } from "../admin/transactionStatusRecompute.js";
import { withTransaction } from "../db/withTransaction.js";
import { NotFoundError, UnauthorizedError } from "../lib/errors.js";

interface MerchantIdParams {
  id: string;
}

export async function adminMerchantsRecomputeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: MerchantIdParams }>(
    "/:id/transactions/recompute-statuses",
    { preHandler: [requireAdminSession, requireAdminRole("finance", "super_admin")] },
    async (request, reply) => {
      const adminAuth = request.adminAuth;
      if (!adminAuth) throw new UnauthorizedError("unauthenticated");
      if (!UUID_RE.test(request.params.id)) throw new NotFoundError("merchant_not_found");
      if (!(await merchantExists(app.db, request.params.id))) {
        throw new NotFoundError("merchant_not_found");
      }

      const result = await withTransaction(app.db, async (client) => {
        const recompute = await recomputeTransactionStatusesForMerchant(client, request.params.id);
        // Status tidy-up never touches merchants.test_mode. reconcileSandboxFlag
        // cleared it whenever no 'authorized' row was seen — but the scan
        // above excludes 'authorized' rows, so openAuthorizations was always
        // 0 and every run on a sandbox merchant flipped it live: CloseBatch
        // (test_mode = false filter) then settled its fake captures as real
        // payouts. Going live is a deliberate onboarding decision, not a
        // side effect of a cleanup button.
        const flagsUpdated: string[] = [];
        await insertAdminAuditLog(client, {
          adminUserId: adminAuth.adminUserId,
          action: "transaction_status_recompute",
          targetType: "merchant",
          targetId: request.params.id,
          metadata: {
            scanned: recompute.scanned,
            updated: recompute.updated,
            flagsUpdated,
          },
        });
        return { ...recompute, flagsUpdated };
      });

      reply.code(200).send(result);
    },
  );
}
