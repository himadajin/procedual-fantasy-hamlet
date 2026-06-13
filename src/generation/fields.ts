import { smoothstep } from './grid';
import type { TerrainData, Vec2 } from './types';

/** Normalized distance from the single world center. */
export function centerDistanceNorm(half: number, p: Vec2): number {
  return Math.hypot(p.x, p.z) / half;
}

/**
 * Influence of the finite diorama boundary.
 *
 * This is not a visual "mountain ring" switch. It is a continuous field used by
 * terrain, vegetation and later placement rules so the world thins out and
 * closes naturally near the edge.
 */
export function edgeInfluenceAt(half: number, p: Vec2): number {
  return smoothstep(0.58, 1.0, centerDistanceNorm(half, p));
}

/** Extra fade outside the playable/readable basin, where fog hides the cutoff. */
export function outerFadeAt(half: number, p: Vec2): number {
  return smoothstep(0.92, 1.28, centerDistanceNorm(half, p));
}

/** How strongly a point belongs to the inner basin used for water/settlement. */
export function basinInfluenceAt(half: number, p: Vec2): number {
  return 1 - smoothstep(0.78, 0.98, centerDistanceNorm(half, p));
}

export function edgeInfluenceOnTerrain(t: TerrainData, p: Vec2): number {
  return edgeInfluenceAt(t.half, p);
}
