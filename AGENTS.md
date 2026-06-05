# Agent guide — ImageGen

Working agreement for **all** coding agents (Claude Code, Codex, Copilot, …)
and human contributors working in this repository. These rules are not
optional. The full house spec lives in the `Hawkynt/project-template` repo
(`STANDARD.md`); this file is the per-repo distillation.

## What this is

A **TypeScript** tool exposing image generation to AI agents (MCP/CLI) by
browser-automating free web UIs or driving local stable-diffusion.cpp.
Build `npm run build` (tsc), tests `npm test` (vitest), dev `npm run dev`.

## Commits

- **Group changes semantically/logically** — one backend/concern per commit.
- **Every subject line starts with a prefix**: `+` added · `-` removed ·
  `*` changed · `#` bug fixed · `!` critical todo.
- Never start a subject with "fix"/"bugfix"/"changed"/"modified".
- **No AI traces anywhere**: no `Co-Authored-By` AI lines, no "Generated
  with" footers, no agent mentions in messages, comments, or authorship.

## The loop (always, in this order)

1. **Before committing**: `npm install && npm run build && npm test` until
   green (exactly what CI runs). Update the README (backends tables,
   acceptance criteria) when behavior changes.
2. **Commit** (rules above) and **push**.
3. **Wait for CI** and fix until green. A pushed change isn't done while the
   workflow it triggered is red.

## Code conventions

- TDD: failing vitest first; cover equivalence classes, boundaries and error
  paths — browser backends get their parsing/transform logic extracted into
  testable pure functions (see `detectImageFormat`).
- DDD layering per the README's domain model — keep value objects immutable
  and backend adapters behind the common backend-base interface.
- Modern TS idioms; two-space indentation; guard clauses over deep nesting.

## README & repo conventions

- Standard frame: title → badges → one-line `>` blockquote; fixed emoji
  mapping for the standard sections (`## 📦 Quick Start`, `## ❤️ Support`,
  `## 📜 License`); the engineering-doc sections keep plain headers.
- License is LGPL-3.0-or-later; the `## ❤️ Support` section and
  `.github/FUNDING.yml` stay intact.
