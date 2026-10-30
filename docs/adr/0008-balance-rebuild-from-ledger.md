# 0008. The balance cache is rebuilt from the ledger, by every path

- **Status:** Accepted
- **Date:** 2026-10-29
- **Supersedes:** 0004
- **Related:** FP-203, migration 0078, HANDOVER "Balances"

## Context

ADR-0004 let the console's **Rebuild cached balances** button read a faster
"settled data" path, `merchant_payable_position`, instead of walking the
ledger. That view summed `scheme_export_lines`: lifetime gross exported to the
scheme. It ignores fees, payouts already sent, refunds and adjustments. One
click overwrote a merchant's cached balance with that figure (FP-203). Only
the CLI's ledger walk put it back.

The handover's finance memo also reports a merchant balance dropping from
135K to 7K after the console action.

## Decision

`merchant_balances.cached_payable_fils` is rebuilt from one definition:
credits minus debits on `merchant_payable` in `ledger_entries`. Migration
0078 redefines `merchant_payable_position` that way, with a covering index,
so the button and `settlement rebuild-balances` agree by construction.

Both rebuild paths lock each merchant's cache row before recomputing. This
serializes a rebuild against settlement's incremental cache update, so a
concurrent close cannot have its delta overwritten.

## Consequences

- The two rebuild paths cannot disagree about their source.
- ADR-0006 is unchanged: **Adjust balance** remains cache-only and is reset
  by a rebuild.
