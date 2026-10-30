# FilsPay — Claude Code

The team's rules for every agent live in `AGENTS.md`; follow them.

@AGENTS.md

## Claude Code specifics

- Permission rules (`.claude/settings.json`) deny edits to the frozen money
  packages and to test files, and ask before seeding, pushing or deleting.
- Custom commands (`.claude/commands/`):
  - `/verify`: full verification on a throwaway database
  - `/triage-finding <description>`: trace, reproduce and classify a suspected defect
  - `/load-test <base-url>`: run the checkout load test and report capacity
