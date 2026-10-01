# Doc ownership & coordination rules

## One writer per doc (everyone else reads only)
| Doc | Writer (only) | Readers |
|-----|---------------|---------|
| `PROJECT.md` | Build (+ user) | all |
| `DESIGN_SYSTEM.md` | Design / Build | Build, Landing, SEO |
| `domains/marketing.md` | Marketing | all |
| `domains/seo.md` | SEO | all |
| `domains/analytics.md` | Analytics | all |
| `domains/testing.md` | Testing | all |
| the app **code** | Build (+ Landing, for landing routes) | all read |
| `agents/*.md` | Build (+ user) — role definitions | all |

## Rules
1. **Never edit a doc you don't own.** Read it; don't rewrite it.
2. **Git is the changelog** — one small commit per change, with a clear message. No hand-kept changelog file.
3. **No agent-to-agent calls.** A cross-domain need → tell the user in plain words.
4. **New-agent boot:** on spawn, read `PROJECT.md` → `.project/agents/<your-role>.md` → your own domain doc → `DESIGN_SYSTEM.md` (only if you touch UI). That's how you "know the project."

## Coordination
- **v1 (now): human relay.** An agent says *"I need X from the build side"* → the user tells the Build agent.
- **v2 (later, optional): `REQUESTS.md`.** An append-only file where any agent adds a build ask and the Build agent picks it up on its next run. Same brain, still no direct agent-to-agent calls.
