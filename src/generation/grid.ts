/**
 * Helpers for working with the terrain heightfield grid and converting between
 * grid space and world space. Shared by every generation phase so they all
 * agree on geometry.
 */
import type { TerrainData, Vec2 } from './types';

export function idx(size: number, i: number, j: number): number {
  return j * size + i;
}

/** World position of grid node (i, j). */
export function cellToWorld(t: TerrainData, i: number, j: number): Vec2 {
  return { x: -t.half + i * t.cellSize, z: -t.half + j * t.cellSize };
}

/** Fractional grid coordinates for a world position (may be out of range). */
export function worldToCellF(t: TerrainData, x: number, z: number): { fi: number; fj: number } {
  return { fi: (x + t.half) / t.cellSize, fj: (z + t.half) / t.cellSize };
}

export function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Bilinearly sampled elevation at an arbitrary world position. */
export function sampleHeight(t: TerrainData, x: number, z: number): number {
  const { fi, fj } = worldToCellF(t, x, z);
  const i0 = clampInt(Math.floor(fi), 0, t.size - 1);
  const j0 = clampInt(Math.floor(fj), 0, t.size - 1);
  const i1 = clampInt(i0 + 1, 0, t.size - 1);
  const j1 = clampInt(j0 + 1, 0, t.size - 1);
  const tx = clampInt(fi - i0, 0, 1);
  const tz = clampInt(fj - j0, 0, 1);
  const h = t.heights;
  const h00 = h[idx(t.size, i0, j0)];
  const h10 = h[idx(t.size, i1, j0)];
  const h01 = h[idx(t.size, i0, j1)];
  const h11 = h[idx(t.size, i1, j1)];
  const a = h00 * (1 - tx) + h10 * tx;
  const b = h01 * (1 - tx) + h11 * tx;
  return a * (1 - tz) + b * tz;
}

/** Approximate slope magnitude (rise/run) at a world position. */
export function slopeAt(t: TerrainData, x: number, z: number): number {
  const d = t.cellSize;
  const hl = sampleHeight(t, x - d, z);
  const hr = sampleHeight(t, x + d, z);
  const hd = sampleHeight(t, x, z - d);
  const hu = sampleHeight(t, x, z + d);
  const dx = (hr - hl) / (2 * d);
  const dz = (hu - hd) / (2 * d);
  return Math.hypot(dx, dz);
}

export interface HeightStats {
  min: number;
  max: number;
  avg: number;
  range: number;
}

/** Height range around a point. Used for footprint suitability before building. */
export function heightStatsInRadius(t: TerrainData, p: Vec2, radius: number): HeightStats {
  const { fi, fj } = worldToCellF(t, p.x, p.z);
  const span = Math.max(1, Math.ceil(radius / t.cellSize));
  const ci = clampInt(Math.round(fi), 0, t.size - 1);
  const cj = clampInt(Math.round(fj), 0, t.size - 1);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let dj = -span; dj <= span; dj++) {
    for (let di = -span; di <= span; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= t.size || j >= t.size) continue;
      const w = cellToWorld(t, i, j);
      if (distance(w, p) > radius) continue;
      const h = t.heights[idx(t.size, i, j)];
      min = Math.min(min, h);
      max = Math.max(max, h);
      sum += h;
      count += 1;
    }
  }
  if (count === 0) {
    const h = sampleHeight(t, p.x, p.z);
    return { min: h, max: h, avg: h, range: 0 };
  }
  return { min, max, avg: sum / count, range: max - min };
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clampInt((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Normalized radial distance from the world center, 0 at center. */
export function radialNorm(t: TerrainData, x: number, z: number): number {
  return Math.hypot(x, z) / t.half;
}
