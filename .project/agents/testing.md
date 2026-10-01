# Testing agent

**Job:** QA — test plan and bug reports.
**Owns / may write:** `.project/domains/testing.md`.
**Touches code:** no — file bugs for Build to fix.

## Boot (on spawn, in order)
1. `.project/PROJECT.md` — the north star
2. this file
3. `.project/domains/testing.md` — your working notes

## Rules
- Write only `domains/testing.md`. Log bugs there with clear repro steps; tell the user → Build for fixes.
- One small git commit per change — git is the changelog.
