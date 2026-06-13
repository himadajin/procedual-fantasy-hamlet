/**
 * Terrain phase. Builds the heightfield that every later phase reads from.
 *
 * The terrain is not decoration: ruggedness is a signed deviation around an
 * ordinary hilly landscape (50), and a continuous boundary field makes the
 * finite diorama close naturally without forcing a mountain ring. World scale
 * sets the physical extent. Buildings adapt to this terrain later; terrain does
 * not know about future monuments or footprints.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, signedFromMid, type WorldParams } from './params';
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
  const ruggedSigned = signedFromMid(params.terrainRuggedness);
  const calm = Math.max(0, -ruggedSigned);
  const rough = Math.max(0, ruggedSigned);
  const scale = frac(params.worldScale);

  // Physical half-extent grows with world scale.
  const half = lerp(58, 150, scale);
  const cellSize = (2 * half) / (GRID - 1);

  // 50 is the ordinary profile. Values below 50 damp the same landform into
  // gentler, more buildable country; values above 50 add sharper relief.
  const amplitude = 14 * (1 - calm * 0.72) * (1 + rough * 1.8);
  const ridgeWeight = 0.16 + rough * 0.72;
  const freq = (2.0 - calm * 0.45 + rough * 0.85) / (2 * half);
  const warpAmp = 9 * (1 - calm * 0.68) + rough * 15;

  // Boundary tendencies. Rugged/defended worlds tend to close with ridges and
  // escarpments; wet worlds tend to close with lower marshy edges. Both are
  // continuous responses to the edge field, not visible modes.
  const water = frac(params.waterPresence);
  const defense = frac(params.defensePressure);
  const highlandTendency = Math.max(0, Math.min(1, rough * 0.78 + defense * 0.18 - water * 0.35));
  const wetlandTendency = Math.max(
    0,
    Math.min(1, water * 0.75 + calm * 0.18 - rough * 0.28 + rng.jitter(0.12)),
  );
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
      const localClosure = boundaryNoise * 0.58 + lobe * 0.42;
      const ridgePatch = smoothstep(0.48, 0.88, localClosure);
      const escarpment = smoothstep(0.72, 0.96, edge) * (1 - outer) * ridgePatch;
      const ridgeHeight =
        lerp(1.5, 18, highlandTendency) *
        escarpment *
        highlandTendency *
        (0.7 + 0.55 * boundaryNoise);
      const wetLowering =
        lerp(1, 15, wetlandTendency) *
        smoothstep(0.5, 0.95, edge) *
        (0.5 + 0.5 * (1 - ridgePatch) + 0.45 * boundaryNoise);
      h += ridgeHeight;
      h -= wetLowering;
      h -= outer * (amplitude * lerp(0.55, 1.25, rugged) + lerp(14, 28, 1 - wetlandTendency));

      heights[idx(GRID, i, j)] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  t.minHeight = minH;
  t.maxHeight = maxH;
  return t;
}
