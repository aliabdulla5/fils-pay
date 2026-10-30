-- FP-203: the admin "Rebuild cached balances" button (RefreshBalanceCache)
-- read merchant_payable_position, which summed scheme_export_lines — the
-- gross card amounts exported to the scheme. That is not what the platform
-- owes a merchant: it ignores fees, payouts already sent, refunds and
-- adjustments. One click overwrote every cached balance with lifetime gross
-- exports (Alpha 4,328.458 -> 4,118.226 BD in the 2026-09-15 export), and
-- only the CLI ledger walk (RebuildAllBalances) put it back.
--
-- ADR-0004 picked the view for speed; the cost was correctness. Same
-- definition as the CLI (credits - debits on merchant_payable), so the two
-- paths now agree by construction, and an index keeps it one cheap
-- aggregate instead of a cold full scan.
CREATE INDEX IF NOT EXISTS idx_ledger_entries_payable_by_merchant
    ON ledger_entries (account_id, merchant_id) INCLUDE (direction, amount_fils);

CREATE OR REPLACE VIEW merchant_payable_position AS
SELECT le.merchant_id,
       COALESCE(SUM(CASE WHEN le.direction = 'credit' THEN le.amount_fils ELSE -le.amount_fils END), 0)
           AS payable_fils
  FROM ledger_entries le
 WHERE le.account_id = 'merchant_payable'
   AND le.merchant_id IS NOT NULL
 GROUP BY le.merchant_id;
