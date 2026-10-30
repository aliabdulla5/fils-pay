# 0007. Month windows that reconcile against batches use the Bahrain month

- **Status:** Accepted
- **Date:** 2026-10-29
- **Supersedes:** 0003, for scripts and reports whose figures are compared with settlement batches
- **Related:** 0002, HANDOVER "March close", `scripts/reconcile_march.ts`

## Context

ADR-0003 put one-off finance scripts on the UTC calendar month, on the
assumption that the three hours moved across each boundary "net out". YA
objected at the time: they belong to a different month. The handover repeats
it for the March sweep ("use the Bahrain month, not a UTC month").

The March residue sweep is compared against batches, which close on
Asia/Bahrain business days. With a UTC window it took 1 March 00:00–03:00
Bahrain out of March and brought 1 April 00:00–03:00 into it. March never
tied for finance.

## Decision

Any monthly window whose result is reconciled against settlement batches
(residue sweeps, scheme-statement checks, batch-total comparisons) uses the
Bahrain calendar month: `[YYYY-MM-01T00:00+03:00, next month 01T00:00+03:00)`.
Corrections posted for such a month are dated inside it.

ADR-0003 still applies to calendar-month reports that are never compared
with batches.

## Consequences

- `monthBounds` in `scripts/reconcile_march.ts` returns Bahrain bounds.
- A monthly figure under this rule matches the sum of that month's batches.
