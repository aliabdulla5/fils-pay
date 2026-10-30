---
description: Full verification on a throwaway database (migrations, typecheck, every suite)
---

Run `scripts/dev/verify.sh` (it needs `VERIFY_PG_URL` pointing at a disposable
Postgres server; never a real one) and report the result.

For every failing test, say which kind it is before suggesting anything:

1. **Regression** from the current change: fix the change.
2. **Known locked test** listed in `AGENTS.md` under "Known locked tests that
   fail on purpose": expected; never revert a fix to make it pass.
3. **Shared-database contamination** (reporting after the API suite): re-run
   that suite alone on its own database to confirm.
4. **Environment** (missing DB, port, toolchain).

Quote the summary lines you actually saw. Do not claim anything passed that
you did not run.
