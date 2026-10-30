-- FP-212: the reporting worker rolls refund.succeeded into the same daily
-- volume row as captures and voids. 0027 never had the refund columns that
-- applyDailySummaryRollup (apps/reporting) writes.
ALTER TABLE merchant_daily_volume
    ADD COLUMN refund_count      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN refund_gross_fils BIGINT  NOT NULL DEFAULT 0;
