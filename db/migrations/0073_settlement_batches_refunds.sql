-- FP-212: refunds adjust the merchant's next settlement batch.
--
-- CloseBatch claims unbatched succeeded refunds (refunds.settlement_batch_id,
-- 0042) alongside capture events and nets them out of the payout. These two
-- columns freeze what it netted, so a batch row still explains itself:
--
--   net_payout_fils = gross_fils - fee_fils - refunded_fils + fee_reversed_fils
--
-- gross_fils / fee_fils keep their meaning (captures, and the fee on them).
ALTER TABLE settlement_batches
    ADD COLUMN refunded_fils     BIGINT NOT NULL DEFAULT 0 CHECK (refunded_fils >= 0),
    ADD COLUMN fee_reversed_fils BIGINT NOT NULL DEFAULT 0 CHECK (fee_reversed_fils >= 0);
