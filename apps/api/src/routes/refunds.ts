import type { FastifyInstance, FastifyRequest } from "fastify";
import { toFils } from "@filspay/money";
import { UUID_RE } from "../admin/merchants.js";
import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
import { assertRefundRequestScope, initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";
import { BadRequestError, ForbiddenError } from "../lib/errors.js";

/**
 * Legacy stub path. The live route is merchant-scoped —
 * `POST /v1/merchants/:merchantId/refunds`, below — matching how payment
 * links and webhooks are registered and what the dashboard's RefundDrawer
 * posts to. transactions.test.ts still pins this path's 501.
 */
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", { preHandler: requireMerchantAuth }, async (_request, reply) => {
    reply.code(501).send({ error: "not_implemented" });
  });
}

interface MerchantIdParams {
  merchantId: string;
}

interface CreateRefundBody {
  transactionId?: string;
  amountFils?: number;
  reason?: string;
}

/** Same rule as routes/transactions.ts: header required, no server-generated fallback. */
function getIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) {
    throw new BadRequestError("idempotency_key_required", "Idempotency-Key header is required");
  }
  return key;
}

/**
 * FP-212. Registered with prefix '/v1/merchants'. Full refund when
 * amountFils is omitted, partial otherwise (integer fils). Owner/finance
 * sessions and API keys only; an admin "view as merchant" grant never moves
 * money, whatever merchant role it maps to.
 */
export async function merchantRefundRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: MerchantIdParams; Body: CreateRefundBody }>(
    "/:merchantId/refunds",
    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
    async (request, reply) => {
      const auth = request.merchantAuth!;
      assertRefundRequestScope(auth, request.params.merchantId);
      if (auth.actorType === "admin_impersonation") {
        throw new ForbiddenError("forbidden");
      }

      const idempotencyKey = getIdempotencyKey(request);
      const { transactionId, amountFils, reason } = request.body ?? {};
      if (typeof transactionId !== "string" || !UUID_RE.test(transactionId)) {
        throw new BadRequestError("invalid_request", "transactionId must be a transaction id");
      }
      if (amountFils !== undefined && (!Number.isSafeInteger(amountFils) || amountFils <= 0)) {
        throw new BadRequestError("invalid_request", "amountFils must be a positive integer number of fils");
      }
      if (reason !== undefined && typeof reason !== "string") {
        throw new BadRequestError("invalid_request", "reason must be a string");
      }

      const result = await initiateMerchantRefund(app.db, app.acquirer, {
        merchantId: auth.merchantId,
        transactionId,
        amountFils: amountFils !== undefined ? toFils(amountFils) : undefined,
        idempotencyKey,
        actor: requireMerchantWriterActor(auth),
        reason,
      });
      reply.code(result.statusCode).send(result.body);
    },
  );
}
