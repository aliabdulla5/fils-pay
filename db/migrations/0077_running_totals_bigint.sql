-- FP-260 / 2026-08-21: EnqueuePayoutNotifications checks NOT EXISTS and then
-- INSERTs; the daemon tick and a CLI run-batch overlapping both passed the
-- check and each enqueued settlement.paid — the merchant got two payout
-- webhooks for one transfer. There is no unique index on outbox_events
-- (0009); a blanket one would block legitimate repeat events, so this one
-- covers exactly "one settlement.paid per batch".
--
-- The incident already left duplicate pairs behind, and CREATE UNIQUE INDEX
-- fails on them. They cannot simply be deleted: webhook_deliveries (0022)
-- references outbox_events, and those deliveries were really sent. Keep the
-- first event per batch as-is and retag the later copies, so the history
-- survives and nothing (dispatcher, reporting) consumes them again.
UPDATE outbox_events dup
   SET event_type = 'settlement.paid.duplicate'
 WHERE dup.event_type = 'settlement.paid'
   AND EXISTS (
         SELECT 1 FROM outbox_events first
          WHERE first.event_type = 'settlement.paid'
            AND first.aggregate_id = dup.aggregate_id
            AND first.id < dup.id
       );

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_settlement_paid_per_batch
    ON outbox_events (aggregate_id)
 WHERE event_type = 'settlement.paid';
