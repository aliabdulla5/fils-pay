# Submission folder

Prepared against `handover/FilsPay_Submission_Guidelines.pdf`. Deadline: Friday 11 pm.

## What is here

| File | Guideline item | State |
|---|---|---|
| `TeamName_FilsPay_Submission.pdf` (+ `.html` source) | 1. Submission document | Drafted in the required section order. Yellow `[…]` blocks are yours to fill in. |
| `TeamName_FilsPay_Slides.pdf` (+ `.html` source) | 2. Slide deck | 8 slides plus appendix, following section 3. Yellow `[…]` blocks are yours to fill in. |
| `evidence/` | Appendix material | Test logs (baseline vs clean `HEAD` + patch), the review patch, the scratch verification scripts. |
| — | 3. Repository link | Not done here: needs your commit and push to your public fork. |
| — | 4. Live deployment | Not done here: needs your server. |

The full findings list is `docs/BUG_INVENTORY.md` (items 1–92).

## Before you submit

1. **Decide about the other session's working-tree edits.** They revert earlier fixes so the locked tests pass:
   - `adjustmentCsvParsing.ts` (10× CSV import)
   - `currentFeeScheduleDisplay.ts` (245 vs 225 bps)
   - `discountAdjustment.ts` (fee-first formula)
   - `dispatcher.ts` (`NODE_ENV === "test"` jitter)
   - `reporting/consumer/applyEvent.ts` (silent skip; breaks the atomicity test and `npm run typecheck`)
   - `scripts/reconcile_march.ts` (UTC month)
   - `apps/reporting/package.json`: its `test` script now runs `db/seed/index.ts` first. The seed truncates the ledger, merchants and admin users in whatever `DATABASE_URL` points to, so `npm test` against a real database would wipe it. **Revert this one before anyone runs the tests.**

   The submission document describes `HEAD` + `evidence/review-fixes.patch`, not those edits. To match it:
   ```
   git checkout -- apps/api/src/admin/adjustmentCsvParsing.ts apps/api/src/fees/currentFeeScheduleDisplay.ts apps/reporting/package.json \
     apps/reporting/src/consumer/applyEvent.ts scripts/reconcile_march.ts \
     apps/api/src/webhooks/dispatcher.ts apps/api/src/payments/discountAdjustment.ts
   git apply submission/evidence/review-fixes.patch --include='apps/api/src/webhooks/dispatcher.ts' \
     --include='apps/api/src/payments/discountAdjustment.ts'
   ```
   The patch restores this review's fixes in those two files on top of `HEAD`'s versions.
2. **Commit and push to your public fork.** `origin` is `https://github.com/aliabdulla5/fils-pay`; confirm it is your public fork. Put the last commit ID on the cover page.
3. **Fill in the yellow placeholders:** team name and members, live URLs, fork link and commit, load-test numbers (section 3), UI screenshots (section 5), your AI setup files (section 6).
4. **Rename the PDFs** to `<YourTeam>_FilsPay_Submission.pdf` and `<YourTeam>_FilsPay_Slides.pdf`.
5. **AI setup files in the repo.** The guidelines want your agent instructions, commands, permission rules and helper scripts in the fork. Note that the existing `CLAUDE.md`, `AGENTS.md` and `.cursorrules` state false facts ("amounts are cents", "settlement windows are UTC"). The document's section 6 says you didn't follow them; consider correcting them before you submit.
6. **Deployment:** the server must stay up until judging ends. Compose now binds Postgres to `127.0.0.1`; add a restart policy and the API limits (0.5 vCPU / 512 MB) if your host needs them.

## Regenerating the PDFs after editing the HTML

```
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=submission/TeamName_FilsPay_Submission.pdf submission/TeamName_FilsPay_Submission.html
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=submission/TeamName_FilsPay_Slides.pdf submission/TeamName_FilsPay_Slides.html
```
