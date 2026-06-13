/**
 * Terrain phase. Builds the heightfield that every later phase reads from.
 *
 * The terrain is not decoration: ruggedness sets relief and cliffs, a soft
 * central knoll gives the monument prominent ground, and a raised, irregular
 * hill rim closes the diorama so it never looks like a cut board. World scale
 * sets the physical extent.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import { idx, smoothstep, lerp } from './grid';
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

  // Edge hills that ring and close the diorama.
  const rimAmp = lerp(14, 34, 0.4 + 0.6 * rugged);
  const rimPhase = rng.range(0, Math.PI * 2);
  const rimLobes = rng.int(3, 6);

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

      // Raised, lobed hill rim that then plunges away into the fog, so the
      // diorama reads as a plateau ringed by hills — never a cut square board.
      const rNorm = r / half;
      const ang = Math.atan2(z, x);
      const lobe = 0.5 + 0.5 * Math.sin(ang * rimLobes + rimPhase);
      const rimNoise = noise.fbm(sx * freq * 2 + 200, sz * freq * 2 + 200, 3);
      // Hill band crests around 0.82 of the radius.
      const rise = smoothstep(0.5, 0.8, rNorm) * (1 - smoothstep(0.82, 1.0, rNorm));
      const rimHeight = rimAmp * (0.55 + 0.45 * lobe) * (0.6 + 0.8 * rimNoise);
      h += rise * rimHeight;
      // Beyond the hills, fall steeply below the basin into the mist.
      const drop = smoothstep(0.9, 1.32, rNorm);
      h -= drop * (amplitude * 1.4 + 30);

      heights[idx(GRID, i, j)] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  t.minHeight = minH;
  t.maxHeight = maxH;
  return t;
}
