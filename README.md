# Procedural Fantasy Hamlet

A 3D single-page app that grows a finite medieval-fantasy diorama — terrain,
water, roads, plazas, buildings, walls, towers, bridges and vegetation as one
integrated box garden — from a **seed** and **seven high-level parameters**.
Everything is generated procedurally; there are no external 3D models or image
textures, and no village / city / castle mode switches. Built with Vite +
TypeScript + React + Three.js (react-three-fiber).

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

The app boots straight into a generated diorama (default seed + parameters).
Adjust the seed and sliders, then press **Generate** — the current diorama stays
on screen under a light "Generating…" badge and is swapped in place. Drag to
orbit, pinch/scroll to zoom, two-finger / right-drag to pan, **Reset camera** to
recenter. Keyboard: `g` regenerates, `r` resets the camera.

## The seven parameters

All are 0–100 sliders; only the seed takes direct text. Each one influences
several aspects of generation, not just a label or color:

| Parameter               | Drives                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| **World Scale**         | Physical extent, amount built, road & margin generosity             |
| **Settlement Pressure** | Building/street density, core density, outward spread               |
| **Defense Pressure**    | Walls, towers, gates, moat, high-ground use, winding roads          |
| **Prosperity**          | Materials, tidiness, roof/window/beam refinement, plaza paving      |
| **Terrain Ruggedness**  | Hills, cliffs, terraces, slope, where footprints can sit            |
| **Water Presence**      | Rivers, ponds, lakes, moats, bridges, shoreline, waterside building |
| **Monumentality**       | Size, rank and presence of the single central monument              |

## How generation works

A pure pipeline, deterministic in `(seed, params)` — the same inputs always
reproduce the same world (no `Math.random`):

```
terrain → water → center → roads → defenses → settlement → vegetation → summary
```

Terrain comes first and is a primary cause, not scenery: a central knoll gives
the monument prominent ground, a lobed hill rim that plunges into fog closes the
diorama, water pools in low ground and a river is carved while skirting the
center. The center is sited by scoring ground for dryness, buildability,
elevation, centrality and shore proximity. Roads are routed by A\* over the
terrain (cost rises with slope and a seeded windiness field), and buildings,
plazas, walls, gates and bridges hang off that skeleton. Building roles
(monument, dwelling, tower, gatehouse, waterside, bridge-house, hall, workshop,
outlier…) emerge from context and drive footprint, massing, roof, material and
detail through a small architectural grammar.

Source layout:

- `src/generation/` — the headless world generator (no Three.js). Unit-tested.
- `src/viewer/` — react-three-fiber viewer + procedural geometry/material builders.
- `src/ui/` — the non-modal control panel (side panel on desktop, bottom sheet on mobile).

## Scripts

```bash
npm run dev          # dev server
npm run build        # typecheck + production build
npm run preview      # serve the production build
npm test             # Vitest unit tests (determinism + parameter effects)
npm run test:e2e     # Playwright E2E (desktop + mobile Chromium)
npm run lint         # ESLint
npm run format       # Prettier
```

> First E2E run: `npx playwright install chromium`.
