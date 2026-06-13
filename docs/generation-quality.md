# Generation Quality Guide

This document captures project-specific lessons for keeping the generated
diorama coherent. It is a review guide and risk map, not a product spec and not
a mandatory checklist for every edit. Product behavior belongs in
`docs/design.md`; this file helps decide what to scrutinize when changing
generation or viewer code.

Use it when working on terrain, water, roads, bridges, plazas, buildings,
defenses, vegetation, materials, viewer geometry, or a visual/spatial bug found
from screenshots or browser inspection.

## Quality Principles

- Prefer causes over patches. When a visual bug appears, try to prevent the
  class of bug through generation rules, data structure, tests, or meshing
  constraints instead of only hiding the symptom.
- Keep the single-rule model intact. Before adding a new special case, check
  whether the existing meaning fields can explain the behavior. If they cannot,
  reconsider the data model or `docs/design.md` rather than adding local
  exceptions.
- Viewer code visualizes generated meaning. Surface detail, materials and mesh
  accents should be derived from generated data such as terrain, water, road
  importance, clearance, frontage, role and prosperity.
- Quality gates should be mechanical where possible. A browser screenshot may
  reveal a bug, but the fix should often add or update unit, viewer, or E2E
  coverage for the invariant that failed.
- Keep documentation current by rewriting stale guidance. Do not accumulate
  conflicting notes that require future agents to know the conversation history.

## Risk Map

These are recurring failure classes to consider when the touched code could
affect them. They are prompts for judgment, not an exhaustive checklist.

### Geometry and Materials

- Coplanar or nearly coplanar faces can cause z-fighting, especially windows,
  trim, beams, road details and bridgeheads.
- Backfaces, incorrect winding or inconsistent normals can make walls, roofs,
  towers or defenses appear transparent from some angles.
- Decorative mesh can drift into scaffold-like artifacts when it is not tied to
  a building face, road edge, roof line or other generated relationship.
- Materials and surface detail should improve legibility without becoming noisy,
  overly bright, or detached from the fantasy-medieval art direction.

### Terrain and Water

- Terrain should read as the first layer of the world, not as a mound or trench
  grown to justify a later building.
- Ruggedness should influence road cost, buildability and footprint acceptance
  indirectly. It should not directly force a city size or inject arbitrary
  valleys under important structures.
- Water presence describes how strongly water participates in the structure, not
  raw water coverage. Check shore, bridge, moat and building relationships
  rather than only the amount of water.
- Large structures and walls need believable contact with the existing land:
  foundations can absorb local relief, but holes, floating spans and terrain
  cuts that contradict the world logic should be treated as structural bugs.

### Roads, Bridges and Plazas

- Roads should be readable as a connected traffic graph between demand points,
  not as isolated painted strips.
- Bridges should be graph crossings with meaningful approaches. A bridge without
  connected roads, or a road/bridge that pierces a building footprint, indicates
  a generation failure rather than a rendering detail.
- Road importance, clearance and frontage are structural concepts. Buildings
  should respond to them, and building candidates that violate protected space
  should be rejected rather than forcing the graph to bend around them.
- Stone, dirt, mixed surfaces, bridgeheads and plaza paving should come from
  road meaning and prosperity, not from random decoration.

### Buildings and Defenses

- A building should have a reason to be where it is: terrain fit, frontage,
  center relationship, water relationship, defense relationship, or edge
  condition.
- Footprint fit is more important than preserving a candidate. Reject candidates
  that need long isolated access, collide with protected space, or sit on
  unsuitable terrain.
- Facades, doors, windows, beams and porches should follow the building's
  strongest relationship. Random orientation quickly makes the settlement feel
  generated rather than planned.
- Roofs, walls, towers, beams and foundations should meet cleanly. Floating,
  penetrating or offset parts are usually signs that the grammar and meshing no
  longer share the same assumptions.

### Viewer and UI

- Browser-only issues are often spatial: flicker, transparency, floating parts,
  camera framing, panel overlap or responsive layout. Prefer targeted browser
  checks for these rather than using the Browser as a default after every edit.
- UI changes should preserve the 3D diorama as the primary surface. Controls are
  non-modal helpers, not a separate configuration app.

## Browser QA

Use Browser QA when correctness is visual or spatial and cannot be confidently
verified by unit tests, typecheck, lint or Playwright assertions alone. Prefer a
small representative set of seeds and parameters over repeatedly checking every
minor edit. Keep `World Scale` moderate unless the task specifically concerns
large worlds.

When Browser QA is used, report what was inspected: the seeds or parameter
families, camera angles if relevant, and the risk classes checked. Screenshots
are useful for visual work, but the important part is explaining which quality
risks were covered.

## Maintaining This Guide

Keep this file short and generalized. Add lessons only when they prevent a class
of future mistakes. Avoid function names, temporary implementation details or
seed-specific anecdotes unless they are necessary to explain a durable risk.
