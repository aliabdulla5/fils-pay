---
description: Trace, reproduce and classify a suspected defect before anyone fixes it
argument-hint: <what looks wrong>
---

Suspected defect: $ARGUMENTS

1. Trace the path from input to side effect (route → handler → SQL / ledger /
   outbox). Name the files and lines.
2. Check what the design says: ARCHITECTURE, the ADRs, HANDOVER, CHANGELOG,
   and `docs/BUG_INVENTORY.md` (is it already fixed, open or intentional?).
3. Check the usual suspects on that path: authorization, validation,
   transaction boundaries and locks, concurrency and idempotency, Asia/Bahrain
   date windows, fils vs BD, database constraints.
4. Reproduce it: a request, a query or a scratch script against a throwaway
   database. Also run the reproduction against the original commit `8b58b0f`
   to show whether the defect is original.
5. Classify it as **confirmed**, **plausible**, **intentional** or **false
   positive**, with the evidence.
6. If confirmed, propose the smallest fix and how to verify it. Do not edit
   tests or the frozen money packages.
