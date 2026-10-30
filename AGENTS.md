# Agent instructions — FilsPay

Shared by every coding agent the team uses: Codex reads this file directly,
Claude Code reaches it through `CLAUDE.md`, Gemini CLI through `GEMINI.md`.
Team Caramel Popcorn, October 2026.

This file replaces earlier agent files that stated wrong facts ("amounts are
cents", "settlement windows are UTC", "docs always beat code"). Agents that
followed them reintroduced fixed bugs. When anything here, in a comment, or in
an old note disagrees with the ADRs, **the ADRs win**.

## Read before changing anything

1. `docs/ARCHITECTURE.md`
2. Every ADR in `docs/adr/` (0007 and 0008 supersede 0003 and 0004)
3. `docs/HANDOVER.md`, `CHANGELOG.md`
4. `docs/BUG_INVENTORY.md`: what is fixed, what is open and why, what is intentional

## Facts that are easy to get wrong

- **Money is integer fils: 1 BD = 1000 fils** (ADR-0001). Columns end in
  `_fils` and are BIGINT. Parse text amounts with `parseBhdToFils` only; never
  `parseFloat`, never "× 100". `toFixed(2)` is never correct for BD.
- **Settlement business day = Asia/Bahrain** (UTC+3, no DST), midnight to
  midnight. Month windows compared with batches use the Bahrain month (ADR-0007).
- **Discounts reduce the amount the MDR is charged on**, not the fee after it
  (`ComputeSettlementFee`, discounted_fee.go).
- **The balance cache is rebuilt from the ledger**, by every path (ADR-0008).
- Payment links: the server clock decides expiry; a link is paid at most once.

## Do not change without a human's sign-off

- `packages/money/` and `apps/settlement/internal/money/` (audited, frozen)
- Test files (`*.test.ts`, `*_test.go`). They are regression-locked.
- The v1 partner API's 501 stubs; `refund.succeeded` stays out of
  `WEBHOOK_ELIGIBLE_EVENT_TYPES` until refund webhooks ship
- `Math.random()` for OTPs, invite codes and link slugs, and the display-name
  comparison in `creditApproval.ts`: both documented decisions, both on the
  open-risk list
- Widening money columns or `platform_stats.total_processed_fils`: needs an
  approved migration plan
- Migrations that have already run anywhere: add a new numbered migration instead

## Known locked tests that fail on purpose

These assert behaviour that was a defect. **A failing one is not a reason to
change code back.** Never "fix" a test by reverting a bug fix.

- `adjustmentImport.test.ts` (3) and `adminAdjustmentImport.test.ts` (1):
  expect "4.75" BD to post 475 fils (the 10x import bug)
- `discountAdjustment.test.ts`: expects the discount off the fee
- `currentFeeScheduleDisplay.test.ts`: expects the latest-entered rate, not
  the rate in effect
- `dispatcher.test.ts` backoff: expects an exact delay from a jittered function
- `scripts/reconcile_march.test.ts`: expects the UTC month
- `apps/settlement/internal/ledger/refresh_test.go` (2): expect the balance
  from scheme export lines (FP-203)
- Reporting tests fail only when run after the API suite in one database
  (leftover outbox rows); they pass on their own database.

## Working rules

- Treat earlier reports, comments and AI answers as leads, not proof. Trace
  the code path and reproduce before calling something a bug; classify each
  lead as confirmed, plausible, intentional or false positive.
- Smallest change that fixes the root cause. No drive-by refactors.
- Never run `npm run seed` against anything but a throwaway database: it
  truncates the ledger, merchants and admin users.
- Production code must not branch on being under test.
- Verify with `scripts/dev/verify.sh` (fresh database, migrations, typecheck,
  all suites). The Go DB tests **skip silently** without `DATABASE_URL`; a bare
  `go test ./...` passing proves little.
- Never claim a test passed unless you ran it and saw the output.
- No deploys, pushes, force-pushes or messages to external systems unless the
  team asks.
