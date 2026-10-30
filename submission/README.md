# Submission folder

Prepared against `handover/FilsPay_Submission_Guidelines.pdf`. Deadline: Friday 11 pm.

## What is here

| File | Guideline item | State |
|---|---|---|
| `CaramelPopcorn_FilsPay_Submission.pdf` (+ `.html` source) | 1. Submission document | Drafted in the required section order. Yellow `[…]` blocks are yours to fill in. |
| `CaramelPopcorn_FilsPay_Slides.pdf` (+ `.html` source) | 2. Slide deck | 8 slides plus appendix, following section 3. Yellow `[…]` blocks are yours to fill in. |
| `evidence/` | Appendix material | Test logs (baseline vs clean `HEAD` + patch), the review patch, the scratch verification scripts. |
| — | 3. Repository link | Not done here: needs your commit and push to your public fork. |
| — | 4. Live deployment | Not done here: needs your server. |

The full findings list is `docs/BUG_INVENTORY.md` (items 1–92).

## Before you submit

1. **The other session's edits are already undone.** Commit `ba163fe` swept them in, and two follow-up commits restore the fixes: "Restore money fixes reverted in ba163fe" and "Remove test-only behaviour and the seeding test script". Nothing to do unless you disagree with them.
2. **Commit and push to your public fork.** `origin` is `https://github.com/aliabdulla5/fils-pay`; confirm it is your public fork. Put the last commit ID on the cover page.
3. **Remaining yellow placeholders:** the last commit ID (cover), live load-test numbers (section 3), and Ali Aldoseri's design screenshots (section 5).
4. **PDF names:** already `CaramelPopcorn_FilsPay_Submission.pdf` and `CaramelPopcorn_FilsPay_Slides.pdf`.
5. **AI setup files in the repo.** The guidelines want your agent instructions, commands, permission rules and helper scripts in the fork. Note that the existing `CLAUDE.md`, `AGENTS.md` and `.cursorrules` state false facts ("amounts are cents", "settlement windows are UTC"). The document's section 6 says you didn't follow them; consider correcting them before you submit.
6. **Deployment:** the server must stay up until judging ends. `docker compose -f ops/docker-compose.yml up -d --build` now brings up an nginx edge on :80 (web app + `/v1`) and :8080 (admin), with restart policies, the API limited to 0.5 vCPU / 512 MB, health checks and load shedding. Put TLS in front of the edge. Re-run `submission/evidence/load/checkout_load.mjs` against the live server and update section 3.

## Regenerating the PDFs after editing the HTML

```
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=submission/CaramelPopcorn_FilsPay_Submission.pdf submission/CaramelPopcorn_FilsPay_Submission.html
"$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=submission/CaramelPopcorn_FilsPay_Slides.pdf submission/CaramelPopcorn_FilsPay_Slides.html
```
