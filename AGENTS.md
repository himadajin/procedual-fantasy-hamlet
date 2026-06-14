# AGENTS.md

Guidance for AI coding agents working in this repository. Human-facing overview
lives in [README.md](README.md); the product specification is
[docs/design.md](docs/design.md).

## What this project is

A 3D single-page app that procedurally grows a finite medieval-fantasy diorama —
terrain, water, roads, plazas, buildings, walls, towers, bridges and vegetation
as one integrated box garden — from a **seed** and **seven 0–100 parameters**.
Stack: Vite + TypeScript + React + Three.js (react-three-fiber + drei).

## Source of truth

- `docs/design.md` is the source of truth for what the app must be. If a task
  changes the intended generation model, parameter semantics, or user-visible
  behavior, update `docs/design.md` first, then make the code match it.
- Do not treat this file as a second product spec. Keep product rules in
  `docs/design.md`; keep agent workflow, repo conventions, verification
  strategy and implementation cautions here.
- When updating docs, maintain them as living documents: remove or rewrite stale
  guidance instead of appending contradictory notes.

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
  builders (`build/`). Generated world data is turned into meshes here.
- `src/ui/` — non-modal control panel (side panel on desktop, bottom sheet on
  mobile), sliders, summary.
- `e2e/` — Playwright specs. `docs/` — project docs. `dist/` — build output
  (generated).

## Code style

- TypeScript, ES modules, React 18 function components + hooks.
- Prettier: single quotes, semicolons, trailing commas (`all`), 100-col width,
  2-space indent.
- ESLint extends `@typescript-eslint/recommended` + `prettier`. `any` is a
  warning — avoid it. Unused vars must be prefixed `_` to be ignored.
- Prefer `import type { ... }` for type-only imports.
- Keep the generation layer free of rendering/DOM/Three.js dependencies.

## Development workflow

- Start by checking the worktree state and reading the relevant docs/code. Never
  revert unrelated user changes.
- By default, complete implementation and verification, then stop before
  committing and report the uncommitted changes. If the user explicitly asks to
  commit, stage and commit with a Conventional Commit message.
- Pick verification based on the change. Do not run expensive visual checks for
  docs-only or purely mechanical edits, but do not skip visual/spatial QA when
  correctness depends on what is rendered.
- Report what you verified. If you skip an otherwise relevant check, briefly say
  why.

## Generation principles

- Determinism is mandatory: the same `(seed, params)` must produce the same
  world. Never use `Math.random`; use the seeded RNG in `src/generation/rng.ts`.
- Preserve one continuous generation rule. Do not add user-visible modes or
  seed-specific patches. Before adding a new special case, ask whether existing
  fields such as terrain, water, center, edge, access, defense and buildability
  already explain the behavior.
- Prefer a small number of strong rules over accumulated ad hoc exceptions.
  Parameters should affect results through shared meaning fields and structural
  constraints, not through direct one-off toggles.
- Terrain comes first. Buildings, roads, defenses and water relationships adapt
  to the existing terrain; large-scale terrain should not be reshaped just to
  make a desired footprint work.
- Roads are traffic graphs, not decorative ribbons. Bridges exist as water
  crossings in that graph, and buildings must respect road, bridge and plaza
  clearance instead of pushing those spaces aside.
- The viewer should make generation data legible. Do not hide structural issues
  with visual-only decoration that contradicts the generated meaning.
- Runtime external models/textures are out of scope. Repo-managed, quality-gated
  texture aids are allowed only within `docs/design.md`; completed buildings,
  bridges, trees or wall models must not replace generated structure.

## Generation quality guide

For visual or spatial generation work, and for bugs reported from screenshots or
browser inspection, read [docs/generation-quality.md](docs/generation-quality.md)
before implementing. It is a review guide and risk map, not a second spec or a
mandatory checklist for every edit.

## Testing and verification

- Generation changes should keep or add unit coverage for determinism,
  parameter effects and structural invariants.
- For reproducible browser/debug checks, use the scenario URL and
  `window.__hamletDebug` interface documented in
  [docs/debug.md](docs/debug.md). Prefer this API when camera state, parameter
  state, or generated summary can be verified directly instead of inferred from
  screenshots or mouse gestures.
- Code changes generally target `npm run typecheck`, `npm run lint`,
  `npm test`, and `npm run format:check` before completion.
- Run `npm run build` when integration risk is non-trivial. Run
  `npm run test:e2e` when viewer/UI behavior needs browser-level assertions.
- Use the in-app Browser for high-value visual/spatial QA: rendered geometry,
  materials, lighting, camera/layout, or screenshot-reported bugs. It is
  intentionally not a default step for every edit.
- When using Browser QA, inspect a small representative set of seeds/parameters,
  keep `World Scale` moderate to avoid slow checks, and report what was checked
  (for example, geometry contact, road/bridge continuity, z-fighting,
  backfaces, UI overlap).

## PRs / commits

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, …).
- Do not commit generated outputs such as `dist/`, `test-results/`, or
  `playwright-report/`.
