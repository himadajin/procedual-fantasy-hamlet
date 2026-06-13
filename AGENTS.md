# AGENTS.md

Guidance for AI coding agents working in this repository. Human-facing overview
lives in [README.md](README.md); the full product specification (in Japanese) is
[docs/design.md](docs/design.md) and is the source of truth for _what_ this app
must be.

## What this project is

A 3D single-page app that procedurally grows a finite medieval-fantasy diorama —
terrain, water, roads, plazas, buildings, walls, towers, bridges and vegetation
as one integrated box garden — from a **seed** and **seven 0–100 parameters**.
Stack: Vite + TypeScript + React + Three.js (react-three-fiber + drei).

## Setup & commands

```bash
npm install
npm run dev          # dev server at http://localhost:5173
npm run build        # tsc -b (typecheck) + vite build
npm run preview      # serve the production build
npm test             # Vitest unit tests (run once)
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Playwright E2E (desktop + mobile Chromium)
npm run lint         # ESLint
npm run lint:fix     # ESLint with --fix
npm run format       # Prettier --write
npm run format:check # Prettier --check
npm run typecheck    # tsc -b --noEmit
```

First E2E run only: `npx playwright install chromium`.

## Code layout

- `src/generation/` — headless world generator. **No Three.js imports here.**
  Pure functions of `(seed, params)`. Unit-tested. Pipeline runs in dependency
  order: `terrain → water → center → roads → defenses → settlement → vegetation
→ summary (see `generate.ts`).
- `src/viewer/` — react-three-fiber viewer + procedural geometry/material
  builders (`build/`). All meshes and materials are generated here.
- `src/ui/` — non-modal control panel (side panel on desktop, bottom sheet on
  mobile), sliders, summary.
- `e2e/` — Playwright specs. `docs/` — spec. `dist/` — build output (generated).

## Code style

- TypeScript, ES modules, React 18 function components + hooks.
- Prettier: single quotes, semicolons, trailing commas (`all`), 100-col width,
  2-space indent. Run `npm run format` before finishing.
- ESLint extends `@typescript-eslint/recommended` + `prettier`. `any` is a
  warning — avoid it. Unused vars must be prefixed `_` to be ignored.
- Prefer `import type { ... }` for type-only imports (existing code does this).
- Keep the generation layer free of rendering/DOM/Three.js dependencies.

## Hard rules from the spec (don't violate)

These come from `docs/design.md` and define the product. Verify changes against
them:

- **Determinism**: same `(seed, params)` ⇒ identical world. Never use
  `Math.random` — all randomness flows from the seeded RNG in
  `src/generation/rng.ts`.
- **One generation rule, no modes**: no village/city/castle mode, no
  river/lake/moat mode, no manual building-type selection. Structure
  self-organizes from terrain, access, and the seven parameters.
- **Every parameter must really bite**: each of the 7 parameters must affect
  multiple aspects of generation, not just labels/colors/the summary.
- **No external assets**: no external 3D models or image textures. All geometry
  and materials are procedural.
- **Out of scope**: manual editing, add/delete buildings, painting, asset
  placement, people, animals, dynamic props, interiors, first-person walking,
  save management, infinite terrain, placeholders, or TODO-left-behind code.
- **UX**: the 3D diorama is always the star. App boots into a pre-generated
  world; regeneration overlays a light "Generating…" state in place (no page
  transition, no full-screen loader). Regenerate only on **Generate** — never
  live on slider drag.

## Testing

- Unit tests (`*.test.ts` in `src/generation/`) cover determinism and that
  parameters actually change output. When you touch generation, keep these green
  and add coverage for new parameter effects.
- Before declaring work done: `npm run typecheck`, `npm run lint`, `npm test`,
  and `npm run format:check`. Run `npm run test:e2e` for viewer/UI changes.

## PRs / commits

- Commit messages follow Conventional Commits (`feat:`, `fix:`, …) — see git
  history.
- Don't commit `dist/`, `test-results/`, or `playwright-report/` (gitignored).
