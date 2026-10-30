import type { PoolClient } from "pg";

/** Counts of outbox_events replayed into each rollup table. */
export interface RebuildAnalyticsSummary {
  volumeRows: number;
  trendRows: number;
}

/** apps/reporting's consumer name (runConsumerPass.ts CONSUMER_NAME). */
const REPORTING_CONSUMER_NAME = "reporting";

/** Truncates and repopulates the two rollup tables
 *  (merchant_daily_volume, merchant_payout_trends) from source.
 *
 *  Source is the outbox, up to the reporting consumer's own watermark, with
 *  the same buckets and fields apps/reporting's applyEvent writes, so the
 *  worker carries on from exactly where this leaves off. Rebuilding from
 *  transaction_events instead dropped every refund (refund_count and
 *  refund_gross_fils came back zero), and it double-counted any capture the
 *  worker had not consumed yet: the rebuild counted it, then the worker
 *  applied its outbox event on top. */
export async function refreshAnalyticsRollups(client: PoolClient): Promise<RebuildAnalyticsSummary> {
  // YA: ACCESS EXCLUSIVE lock is fine while analytics is internal only (Jan 2026)
  // The lock also waits out an in-flight consumer pass and holds back the
  // next one's writes, so the watermark read below cannot move under us.
  await client.query(`TRUNCATE merchant_daily_volume`);
  await client.query(`TRUNCATE merchant_payout_trends`);

  const cursor = await client.query<{ last_processed_id: string }>(
    `SELECT last_processed_id FROM reporting_outbox_cursor WHERE consumer_name = $1`,
    [REPORTING_CONSUMER_NAME],
  );
  const watermark = cursor.rows[0]?.last_processed_id ?? "0";

  // One row per batch, the latest batch_closed event winning, as the
  // consumer's ON CONFLICT DO UPDATE in id order leaves it.
  const trendResult = await client.query(
    `INSERT INTO merchant_payout_trends
        (merchant_id, settlement_batch_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, paid_at, last_updated_at)
     SELECT DISTINCT ON (sb.merchant_id, sb.id)
            (oe.payload->>'merchantId')::uuid, sb.id, (oe.payload->>'batchDate')::date, sb.status,
            (oe.payload->>'grossFils')::bigint, (oe.payload->>'feeFils')::bigint,
            (oe.payload->>'netPayoutFils')::bigint, sb.paid_at, now()
       FROM outbox_events oe
       JOIN settlement_batches sb ON sb.id = (oe.payload->>'batchId')::uuid
      WHERE oe.id <= $1
        AND oe.event_type = 'settlement.batch_closed'
      ORDER BY sb.merchant_id, sb.id, oe.id DESC`,
    [watermark],
  );

  const volumeResult = await client.query(
    `INSERT INTO merchant_daily_volume
        (merchant_id, volume_date, captured_count, captured_gross_fils, voided_count,
         refund_count, refund_gross_fils, last_updated_at)
     SELECT (oe.payload->>'merchantId')::uuid,
            (oe.created_at AT TIME ZONE 'Asia/Bahrain')::date,
            COUNT(*) FILTER (WHERE oe.event_type = 'transaction.captured'),
            COALESCE(SUM((oe.payload->>'amountCapturedFils')::bigint) FILTER (WHERE oe.event_type = 'transaction.captured'), 0),
            COUNT(*) FILTER (WHERE oe.event_type = 'transaction.voided'),
            COUNT(*) FILTER (WHERE oe.event_type = 'refund.succeeded'),
            COALESCE(SUM((oe.payload->>'amountFils')::bigint) FILTER (WHERE oe.event_type = 'refund.succeeded'), 0),
            now()
       FROM outbox_events oe
      WHERE oe.id <= $1
        AND oe.event_type IN ('transaction.captured', 'transaction.voided', 'refund.succeeded')
        AND oe.payload->>'merchantId' IS NOT NULL
      GROUP BY 1, 2`,
    [watermark],
  );

  return { volumeRows: volumeResult.rowCount ?? 0, trendRows: trendResult.rowCount ?? 0 };
}
