/**
 * Water phase. Water pools in low ground (lakes/ponds) and, when water presence
 * is high enough, a meandering river is carved across the basin while skirting
 * the center. The moat is added later by the defenses phase, which mutates this
 * same mask. Nothing here picks a "river mode" or "lake mode": the kinds that
 * emerge fall out of terrain shape, scale and water presence.
 */
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import { cellToWorld, idx, lerp } from './grid';
import { basinInfluenceAt } from './fields';
import type { TerrainData, Vec2, WaterData, WaterBodyKind } from './types';

function quantile(values: Float32Array, q: number): number {
  const arr = Float32Array.from(values);
  arr.sort();
  const pos = Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))));
  return arr[pos];
}

/** Distance from point p to a polyline, plus the nearest parameter. */
function distToPolyline(p: Vec2, path: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const apx = p.x - a.x;
    const apz = p.z - a.z;
    const len2 = abx * abx + abz * abz || 1e-6;
    let t = (apx * abx + apz * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a.x + abx * t;
    const cz = a.z + abz * t;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d < best) best = d;
  }
  return best;
}

export function generateWater(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
): WaterData {
  const rng = new Rng(seedValue).fork('water');
  const water = frac(params.waterPresence);
  const scale = frac(params.worldScale);

  const { size, heights, half } = terrain;
  const mask = new Uint8Array(size * size);
  const kinds: WaterBodyKind[] = [];

  // Consider only the inner basin for the water level. Edge fade and boundary
  // wetlands should not skew the quantile into a surrounding "ocean".
  const basin: number[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const w = cellToWorld(terrain, i, j);
      if (basinInfluenceAt(half, w) > 0.75) basin.push(heights[idx(size, i, j)]);
    }
  }
  const basinArr = Float32Array.from(basin);

  // Water presence is structural participation, not a raw "fill the map"
  // amount. Higher values adopt more low ground into water systems, while the
  // center phase later chooses dry, buildable land from the resulting terrain.
  const targetCoverage = lerp(0.0, 0.34, water);
  const level = quantile(basinArr, Math.max(0.04, targetCoverage));

  // Flood low ground inside the basin only.
  let lowCells = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = idx(size, i, j);
      const w = cellToWorld(terrain, i, j);
      if (basinInfluenceAt(half, w) <= 0.45) continue;
      if (heights[k] < level) {
        mask[k] = 1;
        lowCells++;
      }
    }
  }

  // Carve a river when there is enough water to justify one.
  let riverPath: Vec2[] = [];
  if (water > 0.32) {
    riverPath = carveRiver(rng, terrain, level, water, scale);
    const riverWidth = lerp(3.5, 11, water) * (0.85 + 0.4 * scale);
    const halfW = riverWidth * 0.5;
    const depth = lerp(1.5, 4.5, water);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const w = cellToWorld(terrain, i, j);
        const d = distToPolyline(w, riverPath);
        if (d < halfW) {
          const k = idx(size, i, j);
          // Carve a channel and flag as water.
          const sink = level - depth * (1 - d / halfW);
          if (heights[k] > sink) heights[k] = sink;
          mask[k] = 1;
        }
      }
    }
    kinds.push('river');
  }

  // Recompute extent / min-max after carving.
  let minH = Infinity;
  let maxH = -Infinity;
  let waterCells = 0;
  for (let k = 0; k < heights.length; k++) {
    if (heights[k] < minH) minH = heights[k];
    if (heights[k] > maxH) maxH = heights[k];
    if (mask[k]) waterCells++;
  }
  terrain.minHeight = minH;
  terrain.maxHeight = maxH;

  const coverage = waterCells / mask.length;

  // Classify the still-water bodies that emerged from flooding.
  if (lowCells > 0) {
    if (coverage > 0.16) kinds.push('lake');
    else if (coverage > 0.04) kinds.push('pond');
  }

  return {
    level,
    mask,
    coverage,
    kinds,
    hasMoat: false,
    riverPath,
  };
}

/** A meandering centerline from one rim to the opposite rim, skirting center. */
function carveRiver(
  rng: Rng,
  terrain: TerrainData,
  _level: number,
  water: number,
  scale: number,
): Vec2[] {
  const R = terrain.half * 1.02;
  const entryAng = rng.range(0, Math.PI * 2);
  const exitAng = entryAng + Math.PI + rng.jitter(0.8);
  const start: Vec2 = { x: Math.cos(entryAng) * R, z: Math.sin(entryAng) * R };
  const end: Vec2 = { x: Math.cos(exitAng) * R, z: Math.sin(exitAng) * R };

  // Offset the mid so the river bows past (not through) the center.
  const side = rng.chance(0.5) ? 1 : -1;
  const midAng = entryAng + Math.PI / 2;
  const bow = terrain.half * lerp(0.18, 0.42, 0.5 + 0.5 * water) * side;
  const mid: Vec2 = {
    x: Math.cos(midAng) * bow,
    z: Math.sin(midAng) * bow,
  };

  // Quadratic-ish path with added meander.
  const pts: Vec2[] = [];
  const steps = 40;
  const meanderAmp = terrain.half * lerp(0.04, 0.13, water) * (0.7 + 0.6 * scale);
  const meanderFreq = rng.range(2, 4);
  const phase = rng.range(0, Math.PI * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    // Quadratic Bézier through start, mid, end.
    const omt = 1 - t;
    let x = omt * omt * start.x + 2 * omt * t * mid.x + t * t * end.x;
    let z = omt * omt * start.z + 2 * omt * t * mid.z + t * t * end.z;
    // Perpendicular meander.
    const dirx = end.x - start.x;
    const dirz = end.z - start.z;
    const len = Math.hypot(dirx, dirz) || 1;
    const nx = -dirz / len;
    const nz = dirx / len;
    const m = Math.sin(t * Math.PI * meanderFreq + phase) * meanderAmp * Math.sin(t * Math.PI);
    x += nx * m;
    z += nz * m;
    pts.push({ x, z });
  }
  return pts;
}
