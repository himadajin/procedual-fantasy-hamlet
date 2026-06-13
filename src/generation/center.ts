/**
 * Center siting. The diorama has exactly one dominant center. It is chosen by
 * scoring candidate ground for the qualities the spec asks for: dry, buildable,
 * elevated and defensible (more so under defense pressure), close-ish to the map
 * middle, and drawn toward the shore when water presence is high. The winner
 * anchors roads, walls and the monument.
 */
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import { cellToWorld, heightStatsInRadius, idx, lerp, sampleHeight, slopeAt } from './grid';
import type { TerrainData, Vec2, WaterData } from './types';

export interface CenterResult {
  center: Vec2;
  ground: number;
  /** Nearest distance to water at the center, for monument-by-water decisions. */
  waterDistance: number;
}

export function pickCenter(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
): CenterResult {
  const rng = new Rng(seedValue).fork('center');
  const defense = frac(params.defensePressure);
  const monumentality = frac(params.monumentality);
  const rugged = frac(params.terrainRuggedness);
  const waterAffinity = frac(params.waterPresence);
  const { size, half } = terrain;
  const footprintRadius = lerp(10, 18, monumentality);
  const maxRelief = lerp(4.2, 9.5, rugged);

  // Precompute a coarse distance-to-water field via multi-source BFS-ish
  // expansion on the grid (Chebyshev steps are good enough for siting).
  const waterDist = computeWaterDistance(terrain, water);

  const minH = terrain.minHeight;
  const maxH = terrain.maxHeight;
  const span = Math.max(1e-3, maxH - minH);

  let best = -Infinity;
  let bestI = Math.floor(size / 2);
  let bestJ = Math.floor(size / 2);

  // Evaluate on a subsampled grid for speed; the center need not be pixel exact.
  const step = 2;
  for (let j = step; j < size - step; j += step) {
    for (let i = step; i < size - step; i += step) {
      const k = idx(size, i, j);
      if (water.mask[k]) continue;
      const w = cellToWorld(terrain, i, j);
      const r = Math.hypot(w.x, w.z) / half; // 0 center .. 1 edge
      if (r > 0.72) continue; // keep the center away from the rim

      const h = terrain.heights[k];
      const elev = (h - minH) / span; // 0..1
      const slope = slopeAt(terrain, w.x, w.z);
      const relief = heightStatsInRadius(terrain, w, footprintRadius).range;

      // Buildable: punish steep ground hard.
      if (slope > 0.85) continue;
      if (relief > maxRelief) continue;

      const wd = waterDist[k]; // grid cells to nearest water
      const wdWorld = wd * terrain.cellSize;

      // Centrality: prefer the middle, softly.
      const centrality = 1 - r;
      // Elevation desirability rises with defense pressure (high ground).
      const elevation = elev * (0.4 + 0.9 * defense);
      // Flatness is always nice for a big footprint.
      const flatness = 1 - Math.min(1, slope / 0.85);
      const footprintFit = 1 - Math.min(1, relief / maxRelief);
      // Waterfront pull: when water presence is high, reward being near (but
      // not in) the water — a band a little back from the shore.
      const shoreBand = Math.exp(-Math.pow((wdWorld - 10) / 12, 2));
      const waterfront = waterAffinity > 0.45 ? shoreBand * waterAffinity * 0.9 : 0;

      const score =
        centrality * 1.0 +
        elevation * 1.1 +
        flatness * 0.65 +
        footprintFit * 0.7 +
        waterfront +
        rng.next() * 0.12; // tiny seeded tie-breaker

      if (score > best) {
        best = score;
        bestI = i;
        bestJ = j;
      }
    }
  }

  const center = cellToWorld(terrain, bestI, bestJ);
  const ground = sampleHeight(terrain, center.x, center.z);
  return {
    center,
    ground,
    waterDistance: waterDist[idx(size, bestI, bestJ)] * terrain.cellSize,
  };
}

/** Distance (in grid cells) from each cell to the nearest water cell. */
function computeWaterDistance(terrain: TerrainData, water: WaterData): Float32Array {
  const { size } = terrain;
  const dist = new Float32Array(size * size).fill(Infinity);
  const queue: number[] = [];
  for (let k = 0; k < water.mask.length; k++) {
    if (water.mask[k]) {
      dist[k] = 0;
      queue.push(k);
    }
  }
  if (queue.length === 0) {
    dist.fill(size); // no water at all
    return dist;
  }
  // BFS over 4-neighborhood.
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    const i = k % size;
    const j = (k - i) / size;
    const d = dist[k] + 1;
    const neighbors = [
      [i - 1, j],
      [i + 1, j],
      [i, j - 1],
      [i, j + 1],
    ];
    for (const [ni, nj] of neighbors) {
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const nk = idx(size, ni, nj);
      if (d < dist[nk]) {
        dist[nk] = d;
        queue.push(nk);
      }
    }
  }
  return dist;
}
