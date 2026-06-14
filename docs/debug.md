# Debug and Reproduction Interface

This app exposes a small, non-visual debugging interface for reproducible UI,
generation and camera checks. It is intended for development agents, E2E tests
and bug reports; it is not a product control surface.

## Scenario URLs

The app reads scenario query parameters once on initial page load. A scenario URL
can restore the seed, all seven generation parameters, and optionally the camera
view.

Supported query parameters:

- `seed`: seed string.
- `worldScale`: 0-100.
- `settlementPressure`: 0-100.
- `defensePressure`: 0-100.
- `prosperity`: 0-100.
- `terrainRuggedness`: 0-100.
- `waterPresence`: 0-100.
- `monumentality`: 0-100.
- `camera`: six comma-separated numbers: `px,py,pz,tx,ty,tz`, where `p*` is the
  camera position and `t*` is the orbit target.

Missing or malformed values fall back to defaults. Numeric parameters are rounded
and clamped to `0..100`. Malformed `camera` values are ignored.

Example:

```text
http://localhost:5173/?seed=riverhold&worldScale=82&settlementPressure=55&defensePressure=70&prosperity=60&terrainRuggedness=50&waterPresence=70&monumentality=75&camera=80,55,95,0,8,0
```

## Runtime Debug API

The browser window exposes `window.__hamletDebug` while the app is mounted.

```ts
window.__hamletDebug.getState();
window.__hamletDebug.scenarioUrl();
window.__hamletDebug.setCamera({
  position: { x: 80, y: 55, z: 95 },
  target: { x: 0, y: 8, z: 0 },
});
```

`getState()` returns:

- `seed`: current draft seed.
- `params`: current draft parameters.
- `camera`: current camera `position`, orbit `target`, and `distance`, or `null`
  before the viewer is ready.
- `scenarioUrl`: a full URL for the current draft seed, draft params and camera.
- `world`: the currently rendered world metadata, summary and debug metrics.

`world.metrics` is a compact first-pass diagnostic summary. It intentionally
does not expose every generated object or a full generation trace.

- `terrain`: `minHeight`, `maxHeight`, `heightRange`.
- `water`: `coverage`, kind counts, `hasMoat`, `riverPointCount`.
- `roads`: node, edge, plaza, bridge-edge and clearance counts, plus
  `settlementRadius`.
- `structures`: building count, building role counts, wall segment count, tower
  count, gate count and bridge count.
- `vegetation`: plant count and plant kind counts.

`scenarioUrl()` returns the same full scenario URL string without the rest of the
state payload.

`setCamera(camera)` applies a camera position and orbit target without
regenerating the world.

## DOM-Readable Debug State

The same debug payload is also projected into the DOM for browser automation
surfaces that cannot read custom page globals:

```html
<output data-testid="hamlet-debug-state">...</output>
```

The element is visually hidden but remains queryable from DOM tools. Its
`textContent` is JSON with the same shape as `window.__hamletDebug.getState()`:

```ts
const raw = document.querySelector('[data-testid="hamlet-debug-state"]')?.textContent;
const state = raw ? JSON.parse(raw) : null;
```

Use this DOM state in the in-app Browser when checking camera preservation,
parameter changes, generated summaries, or the current scenario URL. Camera
state updates after orbit-control changes, explicit debug `setCamera()` calls,
and camera resets.

Use `world.metrics` as the first debugging foothold for generation problems:
for example, check `water.coverage` and `roads.bridgeEdgeCount` before judging a
bridge issue visually, or compare `terrain.heightRange` when testing ruggedness.

## Expected Use

- Use scenario URLs to open a precise seed/parameter/camera state.
- Use `getState()` to verify camera preservation, current parameter values and
  generated-world summary without relying on screenshots.
- Use `[data-testid="hamlet-debug-state"]` for the same checks when the browser
  automation environment cannot access `window.__hamletDebug`.
- Use `scenarioUrl()` to capture a failing visual/spatial state for later
  reproduction.
