# Procedural Fantasy Hamlet

Procedural Fantasy Hamlet is a browser-based 3D generator for finite
medieval-fantasy dioramas. From a seed and seven high-level parameters, it grows
terrain, water, roads, plazas, bridges, defenses, buildings and vegetation as
one connected box garden.

The generated structure is procedural and deterministic. There are no
user-visible village, city, castle, river or lake modes; those qualities emerge
from terrain, access, water, defense, center and buildability fields. Runtime
external models and textures are not required. Repo-managed texture aids may
support materials, but completed structures are not dropped in as assets.

Built with Vite, TypeScript, React and Three.js via react-three-fiber.

## Quick Start

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The app boots straight into a generated world.
Adjust the seed and sliders, then press **Generate**; the current diorama stays
on screen under a light generating state and is swapped in place.

Controls:

- Drag to orbit.
- Pinch or scroll to zoom.
- Two-finger drag or right-drag to pan.
- **Reset camera** recenters the view.
- Keyboard: `g` regenerates, `r` resets the camera.

## Generation Model

Generation is pure and deterministic in `(seed, params)`:

```text
terrain -> water -> center -> roads -> defenses -> settlement -> vegetation -> summary
```

Terrain and water come first. Centers, roads, bridges, plazas, buildings,
defenses and vegetation respond to shared meaning fields instead of separate
modes or one-off placement rules. Roads are traffic graphs between demand
points, not decorative painted strips. Building roles and facades emerge from
context such as frontage, water, defense, center and terrain fit.

For the full product contract, see [docs/design.md](docs/design.md).

## Parameters

The UI exposes one editable seed plus seven 0-100 parameters. Default values and
formal semantics live in [docs/design.md](docs/design.md); this is the short
overview:

- **World Scale** controls the physical extent, amount built and margin around
  the diorama.
- **Settlement Pressure** controls how readily buildings and roads gather toward
  the center and spread outward.
- **Defense Pressure** controls walls, towers, gates, moats, guarded approaches
  and defensive use of terrain.
- **Prosperity** controls material refinement, tidiness, roof/window/beam
  quality and paving.
- **Terrain Ruggedness** treats 50 as ordinary hilly terrain; lower and higher
  values affect buildability, route cost and footprint acceptance.
- **Water Presence** controls how strongly water participates in the world
  structure, not raw water coverage.
- **Monumentality** controls the size, rank and presence of the single central
  monument and the space around it.

## Documentation

- [docs/design.md](docs/design.md) — product design source of truth.
- [docs/generation-quality.md](docs/generation-quality.md) — visual and spatial
  generation quality guide.
- [AGENTS.md](AGENTS.md) — coding-agent workflow and repository conventions.

## Project Layout

- `src/generation/` — headless world generator; pure TypeScript, no Three.js.
- `src/viewer/` — react-three-fiber viewer and procedural geometry/material
  builders.
- `src/ui/` — non-modal controls, sliders and summary UI.
- `e2e/` — Playwright browser tests.
- `docs/` — product and generation-quality documentation.

## Common Scripts

```bash
npm run dev          # local Vite dev server
npm run build        # typecheck + production build
npm test             # Vitest unit tests
npm run test:e2e     # Playwright E2E tests
npm run lint         # ESLint
npm run typecheck    # TypeScript only
npm run quality:gate # project quality gate script
npm run format       # Prettier write
npm run format:check # Prettier check
npm run check        # typecheck + lint + tests + quality gate + format check
```

First E2E run only:

```bash
npx playwright install chromium
```
