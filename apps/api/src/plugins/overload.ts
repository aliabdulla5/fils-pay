import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

/** Liveness and readiness must answer while the API sheds load, or the
 *  orchestrator restarts a process that is merely busy. */
const EXEMPT_PATHS = new Set(["/healthz", "/readyz"]);

/**
 * Load shedding. Every request beyond `maxInflightRequests` in flight is
 * refused at once with 503 and `Retry-After`, before it touches the database.
 * Without it, excess requests queued on the 5-connection pool for the full
 * connection timeout and then failed as 500s, while the requests already
 * admitted slowed down with them.
 *
 * A request is counted until its underlying socket request closes, which
 * covers both a finished response and a client that gave up.
 */
async function overload(app: FastifyInstance, opts: { maxInflightRequests: number }): Promise<void> {
  const max = opts.maxInflightRequests;
  if (max <= 0) return;

  let inflight = 0;

  app.addHook("onRequest", async (request, reply) => {
    if (EXEMPT_PATHS.has(request.url)) return;
    if (inflight >= max) {
      reply.header("Retry-After", "1").code(503).send({ error: "overloaded", message: "try again shortly" });
      return reply;
    }
    inflight += 1;
    let released = false;
    request.raw.once("close", () => {
      if (!released) {
        released = true;
        inflight -= 1;
      }
    });
  });
}

export const overloadPlugin = fp(overload, { name: "overload" });
