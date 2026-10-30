#!/usr/bin/env bash
# Full verification on a brand-new throwaway database: migrations, typecheck,
# every TypeScript suite, the scripts suite and the Go suite. Prints one line
# per step and keeps the logs.
#
# Usage:
#   VERIFY_PG_URL=postgres://user:pass@127.0.0.1:55432/postgres scripts/dev/verify.sh
#
# VERIFY_PG_URL must point at a disposable Postgres server (its maintenance
# database). Never a real one: the test suites write freely.
set -uo pipefail

: "${VERIFY_PG_URL:?set VERIFY_PG_URL to the maintenance database of a disposable Postgres server}"
cd "$(dirname "$0")/../.."

db="filspay_verify_$(date +%Y%m%d%H%M%S)"
logs="${VERIFY_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$logs"
node -e '
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.argv[1] });
  c.connect().then(() => c.query(`CREATE DATABASE ${process.argv[2]}`)).then(() => c.end())
   .catch((e) => { console.error(e.message); process.exit(1); });
' "$VERIFY_PG_URL" "$db" || exit 1
export DATABASE_URL="${VERIFY_PG_URL%/*}/$db"
echo "database: $db    logs: $logs"

status=0
step() {
  local name="$1"; shift
  if "$@" > "$logs/$name.log" 2>&1; then
    printf '  %-10s ok\n' "$name"
  else
    printf '  %-10s FAILED (see %s)\n' "$name" "$logs/$name.log"
    status=1
  fi
}

step migrate   npx tsx db/migrate.ts
step typecheck npm run typecheck
step npm-test  npm run test --workspaces --if-present
step scripts   npx tsx --test scripts/*.test.ts
step go        bash -c 'cd apps/settlement && go vet ./... && go test -count=1 ./...'

echo
echo "Summary lines:"
grep -hE '^ℹ (tests|pass|fail) ' "$logs/npm-test.log" "$logs/scripts.log" 2>/dev/null | paste - - - || true
grep -hE '^(ok|FAIL|---)' "$logs/go.log" 2>/dev/null || true
echo
echo "Failing tests listed in AGENTS.md (\"Known locked tests that fail on purpose\") are expected."
exit $status
