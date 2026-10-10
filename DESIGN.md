---
name: "MIKLEDGER"
description: "MIKLEDGER is a small-business bookkeeping and payroll workspace for customers, sales documents, purchases, banking, and financial reports."
colors:
  background: "oklch(0.975 0.008 244)"
  foreground: "oklch(0.25 0.035 251)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.25 0.035 251)"
  popover: "oklch(1 0 0)"
  popover-foreground: "oklch(0.25 0.035 251)"
  primary: "oklch(0.49 0.105 238)"
  primary-foreground: "oklch(0.985 0.004 230)"
  secondary: "oklch(0.955 0.018 226)"
  secondary-foreground: "oklch(0.32 0.055 242)"
  muted: "oklch(0.958 0.009 244)"
  muted-foreground: "oklch(0.57 0.028 248)"
  accent: "oklch(0.94 0.035 186)"
  accent-foreground: "oklch(0.32 0.065 190)"
  destructive: "oklch(0.57 0.22 26)"
  border: "oklch(0.91 0.015 242)"
  input: "oklch(0.91 0.015 242)"
  ring: "oklch(0.61 0.1 230)"
  sidebar-ring: "oklch(0.7 0.11 183)"
  sidebar-border: "oklch(0.31 0.045 248)"
  sidebar-accent-foreground: "oklch(0.97 0.008 225)"
  sidebar-accent: "oklch(0.28 0.05 247)"
  sidebar-primary-foreground: "oklch(0.2 0.045 248)"
  sidebar-primary: "oklch(0.78 0.12 183)"
typography:
  display:
    fontFamily: "System sans, medium-to-semibold weight with tight tracking."
  body:
    fontFamily: "System sans, regular weight; tabular numerals for financial values."
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace"
rounded:
  sm: "calc(var(--radius) * 0.6)"
  md: "calc(var(--radius) * 0.8)"
  lg: "0.625rem"
  xl: "calc(var(--radius) * 1.4)"
  2xl: "calc(var(--radius) * 1.8)"
  3xl: "calc(var(--radius) * 2.2)"
  4xl: "calc(var(--radius) * 2.6)"
---

<!-- Generated from .project/DESIGN_SYSTEM.md + app/globals.css by the engine. Tokens above are normative and mirror the CSS; edit the CSS and DESIGN_SYSTEM.md, not this file. -->

## Overview

Blue-bound operating ledger: a cool-white work surface, deep navy navigation, sea-glass active marks, and crisp financial tables.

## Colors

| Token | Value |
| background | Cool blue-white |
| surface | Clear white |
| text / muted | Navy-charcoal / blue-grey |
| border | Pale blue-grey hairlines |
| primary | Trust blue |
| accent | Sea-glass teal |
| success / warning / danger | Sea-glass / slate / destructive rose |

Declared in `globals.css` as `--color-*` and mirrored in the frontmatter. Use the token, never a raw hex.

## Typography

- Headings: System sans, medium-to-semibold weight with tight tracking.
- Body: System sans, regular weight; tabular numerals for financial values.

- Display: `System sans, medium-to-semibold weight with tight tracking.`
- Body: `System sans, regular weight; tabular numerals for financial values.`
- Mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`

## Layout

- Radius / shadow / spacing rhythm: 10px base radius, 8px spacing rhythm, fine borders, restrained elevation.
- Shared components: The installed shadcn button, input, select, checkbox, dialog, table, and badge primitives.

## Shapes

Radii: `sm` calc(var(--radius) * 0.6), `md` calc(var(--radius) * 0.8), `lg` 0.625rem, `xl` calc(var(--radius) * 1.4), `2xl` calc(var(--radius) * 1.8), `3xl` calc(var(--radius) * 2.2), `4xl` calc(var(--radius) * 2.6)

## Do's and Don'ts

- Voice: Plain and precise. Use clear finance labels, show actual saved figures, and make empty states invite the first real record.

- Do load faces through Fontsource, not `next/font/google`.
- Don't introduce a colour or radius that isn't a token above.
- Don't use gradient text, or a purple/violet gradient as the brand signal.
- Don't use bounce or elastic easing; real objects decelerate smoothly.
