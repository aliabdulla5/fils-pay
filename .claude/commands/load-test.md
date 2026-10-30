---
description: Run the checkout load test against a stack and report capacity
argument-hint: <base-url, e.g. http://127.0.0.1:80>
---

Target: $ARGUMENTS. Confirm with the team first if this is a live server: the
test creates real payment links and payments in its database.

1. Create fresh, unpaid payment links for an approved merchant and write their
   tokens to a file, one per line.
2. Run `node submission/evidence/load/checkout_load.mjs <base-url> <tokens-file>
   "10:20,20:20,40:20,60:20,200:30,40:20" results.json`. Each virtual buyer
   opens a link and pays it, in a loop.
3. Report a table per stage: buyers, paid/s, p50/p95/p99, and the status codes
   seen. 402/502 are the acquirer simulator's deliberate declines and errors;
   503 is load shedding; any 500 is a defect.
4. Run `submission/evidence/load/integrity_check.sql` afterwards and report
   every check. Double charges, unrecorded charges and unbalanced ledger groups
   must all be 0.
