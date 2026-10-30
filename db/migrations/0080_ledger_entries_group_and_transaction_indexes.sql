-- The deferred balance trigger from 0007 (check_ledger_group_balance) runs
-- `SELECT ... FROM ledger_entries WHERE entry_group_id = $1` once per row
-- written, at COMMIT, and nothing indexed entry_group_id: every capture (four
-- legs) paid for four sequential scans of the whole ledger. The cost grew
-- with the table, so checkouts slowed down as the platform got older, and
-- under load Postgres spent its CPU on scans instead of commits.
--
-- processRefund (fee reversal) and the negotiated-discount adjustment read
-- a transaction's legs by transaction_id, which was unindexed as well.
--
-- Plain CREATE INDEX: db/migrate.ts wraps each file in a transaction, which
-- CONCURRENTLY cannot run in. It blocks ledger writes while it builds; on a
-- large production ledger, build these with CONCURRENTLY by hand first (the
-- IF NOT EXISTS below then makes this file a no-op).
CREATE INDEX IF NOT EXISTS idx_ledger_entries_entry_group
    ON ledger_entries (entry_group_id);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction
    ON ledger_entries (transaction_id)
 WHERE transaction_id IS NOT NULL;
