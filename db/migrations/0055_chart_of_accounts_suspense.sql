-- Additional suspense accounts for future reconciliation lanes.
-- 0007's chart is (id, name, kind) with kind IN ('asset','liability','revenue');
-- suspense accounts follow scheme_rounding_residue and are modelled as 'asset'.
--   fx_rounding_difference: rounding differences between fils and scheme-file BD amounts.
--   chargeback_suspense:    chargeback amounts pending acquirer confirmation.

INSERT INTO chart_of_accounts (id, name, kind)
VALUES
  ('fx_rounding_difference', 'FX Rounding Difference (suspense)', 'asset'),
  ('chargeback_suspense',    'Chargeback Suspense',               'asset')
ON CONFLICT (id) DO NOTHING;
