# AGENTS.md — start here

> Shared brain for every agent on this project. Agents run in **separate chats** and
> **never call each other** — they coordinate only through these docs and the user.

## Read on spawn (in order)
1. `.project/PROJECT.md` — the north star (what we're building). **Everyone reads first.**
2. `.project/agents/<your-role>.md` — **your** job, what you own, your rules.
3. `.project/DESIGN_SYSTEM.md` — the committed look (only if you touch UI).

## The roster — one file each in `.project/agents/`
| Role | File |
|------|------|
| Build | `.project/agents/build.md` |
| Design | `.project/agents/design.md` |
| Landing | `.project/agents/landing.md` |
| SEO | `.project/agents/seo.md` |
| Marketing | `.project/agents/marketing.md` |
| Analytics | `.project/agents/analytics.md` |
| Testing | `.project/agents/testing.md` |

Open your own file for exactly what you do and what you may write.

## Universal rules
1. Read `.project/PROJECT.md` before doing anything.
2. Write only the doc(s)/code your role owns (see `.project/OWNERSHIP.md`). Everything else is read-only.
3. You cannot call another agent. Need something outside your job? Tell the user in plain words — they route it.
4. Keep the product consistent — obey `.project/DESIGN_SYSTEM.md`; don't invent a second look.
5. Git history is the changelog — one small commit per change.

## What is already installed (don't rebuild it)
- Next.js App Router + React 19 + TypeScript strict + Tailwind v4. **Exact versions are
  in `package.json` — read it; never assume from memory, never install a package that is
  already listed.**
- **~48 shadcn components in `src/components/ui`** — button, dialog, drawer, sheet,
  sidebar, table, tabs, `field`, `empty`, chart, command, sonner toaster and more.
  **Look there before hand-writing any primitive.** Missing one? `npx shadcn add <name>`
  (never `@latest`).
- Also present: `lucide-react`, `recharts`, `next-themes`, `sonner`, `cmdk`,
  `react-resizable-panels`, `tailwind-merge`, `tw-animate-css`, `cn()` in
  `src/lib/utils.ts`, a mobile breakpoint hook, and `robots.ts` + `sitemap.ts`.
- `src/lib/site.ts` → `siteUrl()`. This app has **no fixed domain until publish** — use
  it for canonical URLs and metadata; never hardcode a domain.

## Things that pass the build and break the app anyway
`tsc` is happy, the build is green, the app is wrong. Nothing warns you.

1. **`next/font/google` is banned** — no Google egress here, so the fetch hangs at
   compile and the preview renders blank. Use the font stack in `globals.css`, or
   self-host a `.woff2` via `next/font/local`.
2. **Never add a second `:root` block to `globals.css`** — the last one wins, so a
   duplicate silently overrides the whole palette. Change values, keep names: every
   `ui` component reads those names.
3. **Never run `shadcn init`** — it rewrites `globals.css` with a default grey palette
   and injects `next/font/google`.
4. **Keep `X-Frame-Options: ALLOWALL` in `next.config.ts`** and the preview-runtime
   `<Script>` in `layout.tsx` — removing either kills the live preview.
5. **At most ONE `page.tsx` may resolve to `/`.** Two route groups with root pages make
   *every* route 500 — and directories cannot be renamed or moved afterwards, so decide
   the tree before writing files.
6. **No raw hex in components**; colours are tokens. Easing comes from the `--ease-*`
   tokens (the `ease-out` / `ease-in-out` utilities already emit real beziers) — never a
   bare CSS `ease-out`, never a one-off `cubic-bezier(…)`.

## Asset weight — `public/` is not a media library
Every file here travels with the project: snapshotted after each build, restored on
every reopen, pushed to the user's repo if GitHub is connected. A large binary committed
to git stays in the history even after it is deleted. That cost repeats forever.

- `public/` holds small static files only: favicon, `robots.txt`, `manifest.json`, one
  OG image, SVG marks, a compressed hero image.
- Budget: any single image under ~500KB; all of `public/` under ~10MB.
- Generate at display size — `.webp`/`.jpg` for photos, `.svg` for marks — and serve
  through `next/image`, not a bare `<img>`.
- **Video is the expensive one:** one hero clip maximum, ≤1080p, compressed, with a
  `poster` and `preload="metadata"`, and only when motion genuinely is the design.
- Files the user attached as references inform what you build; they are not product
  assets and do not belong in `public/`.

## Nothing pretends to work
A nav item, button or CTA whose feature isn't built shows a "coming soon" toast — never
a dead click, never a `#` href that silently does nothing, never a faked success state
or invented data presented as real. **Then tell the user which elements are placeholders**
when you report the work, in plain words.
