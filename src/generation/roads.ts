/**
 * Road phase — the structural skeleton. Roads are routed first; buildings,
 * plazas, gates and bridges hang off them.
 *
 * Main approaches run from the center out to rim anchors (future gates) using
 * A* over the terrain, where cost rises with slope (so roads avoid cliffs and
 * follow contours) and with a seeded "windiness" field (so they meander more
 * under defense pressure). A ring road encircles the core; short lanes branch
 * off to thread the settlement. Where a road crosses water, a bridge is born.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import { cellToWorld, distance, idx, sampleHeight, slopeAt, worldToCellF, clampInt } from './grid';
import type { Bridge, RoadSegment, TerrainData, Vec2, WaterData } from './types';

export interface RoadNetwork {
  roads: RoadSegment[];
  bridges: Bridge[];
  /** Rim anchor points where main roads exit — gate candidates. */
  gateAnchors: Vec2[];
  /** Approximate radius of the built-up settlement. */
  settlementRadius: number;
  /** Notable open junctions (for plaza seeding). */
  junctions: Vec2[];
}

interface HeapNode {
  k: number;
  f: number;
}

/** Minimal binary heap keyed by f. */
class MinHeap {
  private data: HeapNode[] = [];
  get size(): number {
    return this.data.length;
  }
  push(node: HeapNode): void {
    const d = this.data;
    d.push(node);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p].f <= d[i].f) break;
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }
  pop(): HeapNode | undefined {
    const d = this.data;
    if (d.length === 0) return undefined;
    const top = d[0];
    const last = d.pop()!;
    if (d.length > 0) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < d.length && d[l].f < d[s].f) s = l;
        if (r < d.length && d[r].f < d[s].f) s = r;
        if (s === i) break;
        [d[s], d[i]] = [d[i], d[s]];
        i = s;
      }
    }
    return top;
  }
}

function clampCell(size: number, v: number): number {
  return clampInt(v, 0, size - 1);
}

/** A* over the terrain grid from world point `from` to world point `to`. */
function pathfind(
  terrain: TerrainData,
  _water: WaterData,
  cost: Float32Array,
  from: Vec2,
  to: Vec2,
): Vec2[] {
  const { size } = terrain;
  const f0 = worldToCellF(terrain, from.x, from.z);
  const f1 = worldToCellF(terrain, to.x, to.z);
  const si = clampCell(size, Math.round(f0.fi));
  const sj = clampCell(size, Math.round(f0.fj));
  const gi = clampCell(size, Math.round(f1.fi));
  const gj = clampCell(size, Math.round(f1.fj));
  const start = idx(size, si, sj);
  const goal = idx(size, gi, gj);

  const g = new Float32Array(size * size).fill(Infinity);
  const came = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  const heap = new MinHeap();
  g[start] = 0;
  heap.push({ k: start, f: 0 });

  const minStep = 0.5;
  const heuristic = (k: number): number => {
    const i = k % size;
    const j = (k - i) / size;
    return Math.hypot(i - gi, j - gj) * minStep;
  };

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const k = cur.k;
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % size;
    const j = (k - i) / size;
    for (const [di, dj, mul] of dirs) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const nk = idx(size, ni, nj);
      if (closed[nk]) continue;
      const stepCost = (cost[k] + cost[nk]) * 0.5 * mul;
      const tentative = g[k] + stepCost;
      if (tentative < g[nk]) {
        g[nk] = tentative;
        came[nk] = k;
        heap.push({ k: nk, f: tentative + heuristic(nk) });
      }
    }
  }

  // Reconstruct (cells -> world). If unreachable, fall back to a straight line.
  if (came[goal] === -1 && goal !== start) {
    return [from, to];
  }
  const cells: number[] = [];
  let c = goal;
  let guard = 0;
  while (c !== -1 && guard++ < size * size) {
    cells.push(c);
    if (c === start) break;
    c = came[c];
  }
  cells.reverse();
  const pts = cells.map((cell) => {
    const i = cell % size;
    const j = (cell - i) / size;
    return cellToWorld(terrain, i, j);
  });
  return smooth(simplify(pts, 1.2), 2);
}

/** Drop points closer than `minDist` to keep polylines lightweight. */
function simplify(pts: Vec2[], minDist: number): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (distance(out[out.length - 1], pts[i]) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Chaikin corner-cutting for smooth, organic curves. */
function smooth(pts: Vec2[], iterations: number): Vec2[] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) break;
    const next: Vec2[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Build the per-cell movement cost field. */
function buildCostField(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
): Float32Array {
  const { size } = terrain;
  const cost = new Float32Array(size * size);
  const windNoise = new ValueNoise2D(seedValue ^ 0x2c1b3c6d);
  const defense = frac(params.defensePressure);
  const windWeight = 0.4 + 2.4 * defense; // winding approaches under defense
  const slopeWeight = 5 + 9 * frac(params.terrainRuggedness);
  const freq = 3.5 / terrain.half;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = idx(size, i, j);
      const w = cellToWorld(terrain, i, j);
      const slope = slopeAt(terrain, w.x, w.z);
      let c = 0.6 + slopeWeight * slope * slope;
      // Winding field: low-frequency noise nudges roads off straight lines.
      c += windWeight * windNoise.fbm(w.x * freq + 13, w.z * freq - 8, 3);
      // Crossing water is costly but permitted — becomes a bridge.
      if (water.mask[k]) c += 14;
      cost[k] = c;
    }
  }
  return cost;
}

/** Detect where a road polyline crosses water and emit bridges. */
function extractBridges(
  road: RoadSegment,
  terrain: TerrainData,
  water: WaterData,
  bridges: Bridge[],
): void {
  const pts = road.points;
  let inWater = false;
  let entry: Vec2 | null = null;
  const isWater = (p: Vec2): boolean => {
    const f = worldToCellF(terrain, p.x, p.z);
    const i = clampCell(terrain.size, Math.round(f.fi));
    const j = clampCell(terrain.size, Math.round(f.fj));
    return water.mask[idx(terrain.size, i, j)] === 1;
  };
  for (let i = 0; i < pts.length; i++) {
    const wet = isWater(pts[i]);
    if (wet && !inWater) {
      inWater = true;
      entry = pts[Math.max(0, i - 1)];
    } else if (!wet && inWater && entry) {
      inWater = false;
      const exit = pts[i];
      const span = distance(entry, exit);
      if (span > 3) {
        bridges.push({
          a: entry,
          b: exit,
          deckLevel: water.level + 1.6,
          width: road.width + 1.2,
          hasHouse: false,
        });
      }
    }
  }
}

export function generateRoads(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
  center: Vec2,
): RoadNetwork {
  const rng = new Rng(seedValue).fork('roads');
  const settlement = frac(params.settlementPressure);
  const scale = frac(params.worldScale);
  const cost = buildCostField(seedValue, params, terrain, water);

  const roads: RoadSegment[] = [];
  const bridges: Bridge[] = [];
  const gateAnchors: Vec2[] = [];
  const junctions: Vec2[] = [center];

  const settlementRadius = Math.min(
    terrain.half * 0.62,
    terrain.half * (0.26 + 0.34 * settlement) * (0.78 + 0.32 * scale),
  );

  // Main approaches: 2..4 radial roads to the rim.
  const approachCount = 2 + Math.round(settlement * 1.6 + scale * 0.8);
  const baseAng = rng.range(0, Math.PI * 2);
  const mainWidth = 3.4 + 1.4 * frac(params.prosperity);
  for (let a = 0; a < approachCount; a++) {
    const ang = baseAng + (a / approachCount) * Math.PI * 2 + rng.jitter(0.25);
    const rimR = terrain.half * rng.range(0.82, 0.98);
    const anchor: Vec2 = { x: Math.cos(ang) * rimR, z: Math.sin(ang) * rimR };
    gateAnchors.push(anchor);
    const pts = pathfind(terrain, water, cost, center, anchor);
    const road: RoadSegment = { points: pts, width: mainWidth, klass: 'main' };
    roads.push(road);
    extractBridges(road, terrain, water, bridges);
    junctions.push(anchor);
  }

  // Ring road around the core (encircling street).
  const ring = buildRingRoad(rng, terrain, water, center, settlementRadius);
  if (ring) {
    roads.push(ring);
    extractBridges(ring, terrain, water, bridges);
  }

  // Branch lanes: short streets spurring off main roads into the settlement.
  const laneCount = Math.round(4 + settlement * 10 + scale * 3);
  for (let l = 0; l < laneCount; l++) {
    const parent = rng.pick(roads.filter((r) => r.klass !== 'lane'));
    if (!parent || parent.points.length < 4) continue;
    const t = rng.range(0.2, 0.8);
    const startIdx = Math.floor(parent.points.length * t);
    const start = parent.points[startIdx];
    if (distance(start, center) > settlementRadius * 1.15) continue;
    // Spur toward a nearby point within the settlement.
    const ang = rng.range(0, Math.PI * 2);
    const len = rng.range(settlementRadius * 0.25, settlementRadius * 0.7);
    const target: Vec2 = {
      x: start.x + Math.cos(ang) * len,
      z: start.z + Math.sin(ang) * len,
    };
    const pts = pathfind(terrain, water, cost, start, target);
    if (pts.length < 2) continue;
    const lane: RoadSegment = {
      points: pts,
      width: 2.0 + 0.8 * frac(params.prosperity),
      klass: rng.chance(0.4) ? 'street' : 'lane',
    };
    roads.push(lane);
    extractBridges(lane, terrain, water, bridges);
    junctions.push(start);
  }

  // Give a couple of bridges a small bridge-house when prosperity & water are up.
  if (bridges.length > 0 && frac(params.waterPresence) > 0.5) {
    const n = Math.min(bridges.length, rng.chance(frac(params.prosperity)) ? 2 : 1);
    for (let i = 0; i < n; i++) bridges[i].hasHouse = true;
  }

  // Snap road points onto the (possibly carved) terrain so rendering is exact.
  void sampleHeight; // heights are sampled at render time; kept deterministic here

  return { roads, bridges, gateAnchors, settlementRadius, junctions };
}

function buildRingRoad(
  rng: Rng,
  _terrain: TerrainData,
  _water: WaterData,
  center: Vec2,
  radius: number,
): RoadSegment | null {
  if (radius < 12) return null;
  const segments = 28;
  const phase = rng.range(0, Math.PI * 2);
  const wobble = radius * 0.12;
  const pts: Vec2[] = [];
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    const r = radius + Math.sin(a * 3 + phase) * wobble + rng.jitter(wobble * 0.4);
    pts.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r });
  }
  const road: RoadSegment = { points: smooth(pts, 1), width: 2.6, klass: 'street' };
  return road;
}
