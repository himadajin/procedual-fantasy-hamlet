/**
 * Terrain phase. Builds the heightfield that every later phase reads from.
 *
 * The terrain is not decoration: ruggedness sets relief and cliffs, a soft
 * central knoll gives the monument prominent ground, and a continuous boundary
 * field makes the finite diorama close naturally without forcing a mountain
 * ring. World scale sets the physical extent.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import { idx, smoothstep, lerp } from './grid';
import { edgeInfluenceAt, outerFadeAt } from './fields';
import type { TerrainData } from './types';

/** Fixed grid resolution — extent scales with worldScale, not vertex count. */
const GRID = 150;

export function generateTerrain(seedValue: number, params: WorldParams): TerrainData {
  const rng = new Rng(seedValue).fork('terrain');
  const noise = new ValueNoise2D(seedValue ^ 0x9e3779b9);
  const warpNoise = new ValueNoise2D(seedValue ^ 0x51ed270b);

  const rugged = frac(params.terrainRuggedness);
  const scale = frac(params.worldScale);

  // Physical half-extent grows with world scale.
  const half = lerp(58, 150, scale);
  const cellSize = (2 * half) / (GRID - 1);

  // Relief amplitude and ridge weight scale with ruggedness.
  const amplitude = lerp(7, 50, rugged);
  const ridgeWeight = lerp(0.1, 0.95, rugged);
  // Base noise frequency: more rugged worlds get slightly busier relief.
  const freq = lerp(1.7, 3.0, rugged) / (2 * half);
  const warpAmp = lerp(8, 26, rugged);

  // Central knoll: gives the future monument elevated, prominent ground.
  const knollHeight =
    lerp(3, 16, frac(params.monumentality)) + lerp(0, 10, frac(params.defensePressure));
  const knollRadius = half * lerp(0.16, 0.28, scale);

  // Boundary tendencies. Rugged/defended worlds tend to close with ridges and
  // escarpments; wet worlds tend to close with lower marshy edges. Both are
  // continuous responses to the edge field, not visible modes.
  const water = frac(params.waterPresence);
  const defense = frac(params.defensePressure);
  const highlandTendency = Math.max(0, Math.min(1, rugged * 0.75 + defense * 0.25 - water * 0.35));
  const wetlandTendency = Math.max(0, Math.min(1, water * 0.8 - rugged * 0.25 + rng.jitter(0.12)));
  const boundaryPhase = rng.range(0, Math.PI * 2);
  const boundaryLobes = rng.int(3, 7);

  const heights = new Float32Array(GRID * GRID);

  const t: TerrainData = {
    size: GRID,
    half,
    heights,
    cellSize,
    minHeight: 0,
    maxHeight: 0,
  };

  let minH = Infinity;
  let maxH = -Infinity;

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -half + i * cellSize;
      const z = -half + j * cellSize;

      // Domain warp for organic, non-griddy shapes.
      const wx = (warpNoise.fbm(x * freq * 0.5 + 11, z * freq * 0.5 - 7, 3) - 0.5) * warpAmp;
      const wz = (warpNoise.fbm(x * freq * 0.5 - 5, z * freq * 0.5 + 23, 3) - 0.5) * warpAmp;
      const sx = x + wx;
      const sz = z + wz;

      const base = noise.fbm(sx * freq + 50, sz * freq + 50, 5);
      const ridge = noise.ridged(sx * freq * 1.3 + 9, sz * freq * 1.3 + 4, 4);

      let h = (base - 0.5) * amplitude;
      h += (ridge - 0.35) * amplitude * ridgeWeight;

      // Central knoll (gaussian-ish bump).
      const r = Math.hypot(x, z);
      const knoll = Math.exp(-(r * r) / (2 * knollRadius * knollRadius));
      h += knoll * knollHeight;

      // Gently lower the immediate center so the knoll has a readable platform
      // top rather than a sharp peak.
      h -= knoll * knoll * knollHeight * 0.22;

      // Boundary pressure: as a point approaches the finite edge, terrain
      // becomes less buildable and more environmental. It may become ridged,
      // marshy or simply fade down into fog depending on the same parameters
      // that drive the rest of the world.
      const p = { x, z };
      const edge = edgeInfluenceAt(half, p);
      const outer = outerFadeAt(half, p);
      const ang = Math.atan2(z, x);
      const lobe = 0.5 + 0.5 * Math.sin(ang * boundaryLobes + boundaryPhase);
      const boundaryNoise = noise.fbm(sx * freq * 2 + 200, sz * freq * 2 + 200, 3);
      const escarpment = smoothstep(0.68, 0.9, edge) * (1 - outer);
      const ridgeHeight =
        lerp(4, 28, highlandTendency) * escarpment * (0.35 + 0.45 * lobe + 0.55 * boundaryNoise);
      const wetLowering =
        lerp(1, 14, wetlandTendency) * smoothstep(0.45, 0.95, edge) * (0.45 + 0.75 * boundaryNoise);
      h += ridgeHeight;
      h -= wetLowering;
      h -= outer * (amplitude * lerp(0.75, 1.35, rugged) + lerp(18, 34, 1 - wetlandTendency));

      heights[idx(GRID, i, j)] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  t.minHeight = minH;
  t.maxHeight = maxH;
  return t;
}
