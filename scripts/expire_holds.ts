#!/usr/bin/env -S npx tsx
/**
 * Nightly janitor: a hold that's never captured or released just sits in
 * the table past its expires_at forever — nothing else in the platform
 * ever deletes a holds row (authorize.ts inserts one, capture.ts/void.ts
 * release one; nothing sweeps one). Run once a night from cron/the host's
 * own scheduler.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/expire_holds.ts
 */
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { buildDelete } from "./lib/sqlFilter.js";

/** Holds that outlived their authorization window without being captured
 *  or released — the candidate set for tonight's cleanup. */
export async function fetchExpiredHoldIds(client: Client, opts: { forUpdate?: boolean } = {}): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM holds WHERE status = 'active' AND expires_at < now()${opts.forUpdate ? " FOR UPDATE" : ""}`,
  );
  return result.rows.map((r) => r.id);
}

export function buildExpiredHoldsDelete(expiredIds: string[]): { text: string; values: unknown[] } {
  return buildDelete("holds", { id: expiredIds });
}

/**
 * Deletes only holds that are still 'active' and past expires_at. Captured
 * or released holds are never touched, and a night with nothing expired
 * changes no rows.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("expire_holds: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // One transaction, candidate rows locked: a capture or void releasing one
    // of these holds waits for us instead of having its hold deleted between
    // the SELECT and the DELETE. A night with nothing expired deletes nothing
    // — an empty id list used to drop the WHERE clause and empty the table.
    await client.query("BEGIN");
    try {
      const expiredIds = await fetchExpiredHoldIds(client, { forUpdate: true });
      let deleted = 0;
      if (expiredIds.length > 0) {
        const { text, values } = buildExpiredHoldsDelete(expiredIds);
        deleted = (await client.query(text, values)).rowCount ?? 0;
      }
      await client.query("COMMIT");
      console.log(`expire_holds: matched ${expiredIds.length} abandoned hold(s), deleted ${deleted} row(s)`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
