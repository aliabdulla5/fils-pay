#!/usr/bin/env -S npx tsx
/**
 * One-off March 2026 reconciliation sweep. Finance wants the scheme
 * rounding residue (the gap between what gets journaled at capture and
 * what the scheme export can actually carry at 2 decimal places) written
 * off for March before the books close on it. Run manually, once — see
 * scripts/out/reconcile-2026-03.log for the last real run's output.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/reconcile_march.ts
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { formatBhd, toFils } from "@filspay/money";

/** Asia/Bahrain is UTC+3 all year (no DST since 1972) — window.go. */
const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * The Bahrain calendar month: [1st 00:00 Asia/Bahrain, next 1st 00:00), as
 * UTC instants. The residue swept here is the residue of batch lines, and
 * batches close on Bahrain business days (ADR-0003's own daily rule), so the
 * month has to be cut the same way. The UTC month moved the first three
 * Bahrain hours of March into February and the first three of April into
 * March — the gap HANDOVER warned about ("use the Bahrain month, not a UTC
 * month") and the reason March never tied for finance (ADR-0007).
 */
export function monthBounds(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export interface ResidueRow {
  merchantId: string;
  capturedFils: number;
}

/** The fils truncated away when a captured amount is quantized down to the
 *  scheme export's 2-decimal-place granularity. */
// MK: % 10 on a non-negative int. correct.
export function computeResidueFils(capturedFils: number): number {
  return capturedFils % 10;
}

interface MerchantResidue {
  merchantId: string;
  lineCount: number;
  residueFils: number;
}

async function fetchResidueRows(client: Client, year: number, month: number): Promise<ResidueRow[]> {
  const { start, end } = monthBounds(year, month);
  const result = await client.query<{ merchant_id: string; captured_fils: string }>(
    `SELECT merchant_id, captured_fils
       FROM transactions
      WHERE captured_fils > 0
        AND captured_fils % 10 <> 0
        AND occurred_at >= $1 AND occurred_at < $2
      ORDER BY merchant_id, occurred_at`,
    [start.toISOString(), end.toISOString()],
  );
  return result.rows.map((r) => ({ merchantId: r.merchant_id, capturedFils: Number(r.captured_fils) }));
}

/**
 * One correction group per merchant. lineCount is the number of transactions
 * with a non-zero residue, not the number of scheme lines.
 */
function groupByMerchant(rows: ResidueRow[]): MerchantResidue[] {
  const byMerchant = new Map<string, MerchantResidue>();
  for (const row of rows) {
    const residue = computeResidueFils(row.capturedFils);
    const existing = byMerchant.get(row.merchantId);
    if (existing) {
      existing.lineCount += 1;
      existing.residueFils += residue;
    } else {
      byMerchant.set(row.merchantId, { merchantId: row.merchantId, lineCount: 1, residueFils: residue });
    }
  }
  return [...byMerchant.values()];
}

// Re-running was NOT safe: entry_group_id is a fresh randomUUID() per run,
// so it dedupes nothing, and a second run posted March's residue again. The
// sweep's own description is its business key — a merchant that already has
// it is skipped (returns false).
//
// The legs are ADR-0002's, the same pair CloseBatch now posts per line: the
// residue leaves card_scheme_clearing for the scheme_rounding_residue
// suspense account. The old legs debited merchant_payable — charging each
// merchant for fils the *scheme* did not settle. `effectiveAt` dates the
// correction in the period it corrects (ARCHITECTURE "The ledger"), not on
// whatever day the script happened to run.
async function postResidueCorrection(client: Client, merchant: MerchantResidue, effectiveAt: Date): Promise<boolean> {
  if (merchant.residueFils <= 0) return false;
  const description = "March 2026 scheme rounding residue sweep — manual recon per finance";
  const already = await client.query(
    `SELECT 1 FROM ledger_entries WHERE merchant_id = $1 AND description = $2 LIMIT 1`,
    [merchant.merchantId, description],
  );
  if (already.rowCount) return false;
  const entryGroupId = randomUUID();
  await client.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'card_scheme_clearing', 'credit', $3, $4, $5),
            ($1, $2, 'scheme_rounding_residue', 'debit', $3, $4, $5)`,
    [entryGroupId, merchant.merchantId, merchant.residueFils, effectiveAt.toISOString(), description],
  );
  return true;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("reconcile_march: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const now = new Date();
  const { start, end } = monthBounds(2026, 3);
  // The last instant of the Bahrain month: corrections belong to March.
  const effectiveAt = new Date(end.getTime() - 1);

  // Every run is appended to the log, each line stamped with its run time.
  // The old log was the console redirected with `>`: a second run replaced
  // the first, so the log only ever showed one timestamp and a double run
  // (the doubled gap) left no trace.
  const lines: string[] = [];
  const log = (line: string): void => {
    console.log(line);
    lines.push(`[run ${now.toISOString()}] ${line}`);
  };

  try {
    const rows = await fetchResidueRows(client, 2026, 3);
    const merchantResidues = groupByMerchant(rows);
    const totalResidueFils = merchantResidues.reduce((sum, m) => sum + m.residueFils, 0);

    log("=== March 2026 reconciliation sweep ===");
    log(`run at: ${now.toISOString()}`);
    log(`window (Asia/Bahrain): ${start.toISOString()} .. ${end.toISOString()}`);
    log(`entries dated: ${effectiveAt.toISOString()}`);
    log("");

    let postedResidueFils = 0;
    await client.query("BEGIN");
    try {
      for (const merchant of merchantResidues) {
        // Serialize concurrent runs on the same merchant's check-then-insert.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('reconcile_march'), hashtext($1))`, [
          merchant.merchantId,
        ]);
        const posted = await postResidueCorrection(client, merchant, effectiveAt);
        if (posted) postedResidueFils += merchant.residueFils;
        log(
          `merchant ${merchant.merchantId}: ${merchant.lineCount} line(s), residue ${formatBhd(toFils(merchant.residueFils))} BD (${merchant.residueFils} fils)` +
            (posted ? "" : " — already swept, skipped"),
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    log("---");
    log(`total lines matched: ${rows.length}`);
    log(`total residue found: ${formatBhd(toFils(totalResidueFils))} BD (${totalResidueFils} fils)`);
    log(`posted this run: ${formatBhd(toFils(postedResidueFils))} BD (${postedResidueFils} fils)`);
    log("");
    log("reconciliation applied successfully");
  } catch (err) {
    log(`FAILED: ${String(err)}`);
    throw err;
  } finally {
    await client.end();
    const logDir = new URL("./out/", import.meta.url);
    mkdirSync(logDir, { recursive: true });
    appendFileSync(new URL("reconcile-2026-03.log", logDir), lines.join("\n") + "\n");
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
