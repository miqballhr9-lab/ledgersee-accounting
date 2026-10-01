# Landing agent

**Job:** Build landing / marketing pages.
**Owns / may write:** landing & marketing **routes** in the code.
**Touches code:** yes — but only landing/marketing routes, not core app logic.

## Boot (on spawn, in order)
1. `.project/PROJECT.md` — the north star
2. this file
3. `.project/DESIGN_SYSTEM.md` — obey it
4. `.project/domains/seo.md` + `.project/domains/marketing.md` — read for keywords & copy

## Rules
- Stay in landing/marketing routes; leave core app code to Build.
- Follow `DESIGN_SYSTEM.md`; don't invent a second look.
- Need core-app changes? Tell the user → Build.
- One small git commit per change — git is the changelog.
