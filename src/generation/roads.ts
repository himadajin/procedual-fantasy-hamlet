/**
 * Road phase — demand-point graph over terrain.
 *
 * Roads are not decorative ribbons. A small set of primary demand nodes
 * (center, gates, water access and neighborhood centers) is connected through a
 * terrain-cost graph. Each edge carries importance, clearance and frontage; the
 * settlement phase reads those values to place buildings without invading the
 * transport skeleton.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import {
  cellToWorld,
  clampInt,
  distance,
  idx,
  lerp,
  sampleHeight,
  slopeAt,
  worldToCellF,
} from './grid';
import type {
  Bridge,
  ClearanceCorridor,
  Plaza,
  RoadEdge,
  RoadGraph,
  RoadNode,
  RoadNodeId,
  RoadSurface,
  TerrainData,
  Vec2,
  WaterCrossing,
  WaterData,
} from './types';

interface HeapNode {
  k: number;
  f: number;
}

interface DemandNode {
  kind: RoadNode['kind'];
  position: Vec2;
  importance: number;
}

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

function pathfind(terrain: TerrainData, cost: Float32Array, from: Vec2, to: Vec2): Vec2[] {
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

  const heuristic = (k: number): number => {
    const i = k % size;
    const j = (k - i) / size;
    return Math.hypot(i - gi, j - gj) * 0.5;
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
      const tentative = g[k] + (cost[k] + cost[nk]) * 0.5 * mul;
      if (tentative < g[nk]) {
        g[nk] = tentative;
        came[nk] = k;
        heap.push({ k: nk, f: tentative + heuristic(nk) });
      }
    }
  }

  if (came[goal] === -1 && goal !== start) return [from, to];

  const cells: number[] = [];
  let c = goal;
  let guard = 0;
  while (c !== -1 && guard++ < size * size) {
    cells.push(c);
    if (c === start) break;
    c = came[c];
  }
  cells.reverse();
  return smooth(
    simplify(
      cells.map((cell) => {
        const i = cell % size;
        const j = (cell - i) / size;
        return cellToWorld(terrain, i, j);
      }),
      1.2,
    ),
    2,
  );
}

function simplify(pts: Vec2[], minDist: number): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (distance(out[out.length - 1], pts[i]) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

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
  const rugged = frac(params.terrainRuggedness);
  const windWeight = 0.35 + 2.1 * defense;
  const slopeWeight = 4.5 + 10 * rugged;
  const freq = 3.5 / terrain.half;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = idx(size, i, j);
      const w = cellToWorld(terrain, i, j);
      const slope = slopeAt(terrain, w.x, w.z);
      let c = 0.6 + slopeWeight * slope * slope;
      c += windWeight * windNoise.fbm(w.x * freq + 13, w.z * freq - 8, 3);
      if (water.mask[k]) c += 12 + 8 * (1 - frac(params.waterPresence));
      cost[k] = c;
    }
  }
  return cost;
}

function isWater(terrain: TerrainData, water: WaterData, p: Vec2): boolean {
  const f = worldToCellF(terrain, p.x, p.z);
  const i = clampCell(terrain.size, Math.round(f.fi));
  const j = clampCell(terrain.size, Math.round(f.fj));
  return water.mask[idx(terrain.size, i, j)] === 1;
}

function waterCrossingFor(
  pts: Vec2[],
  terrain: TerrainData,
  water: WaterData,
  width: number,
): WaterCrossing | null {
  let inWater = false;
  let entry: Vec2 | null = null;
  for (let i = 0; i < pts.length; i++) {
    const wet = isWater(terrain, water, pts[i]);
    if (wet && !inWater) {
      inWater = true;
      entry = pts[Math.max(0, i - 1)];
    } else if (!wet && inWater && entry) {
      const exit = pts[i];
      const span = distance(entry, exit);
      if (span > 2.8 && span < terrain.half * 0.45) {
        return { a: entry, b: exit, deckLevel: water.level + 1.6, width };
      }
      inWater = false;
      entry = null;
    }
  }
  return null;
}

function edgeWidth(importance: number): number {
  return lerp(2.0, 4.8, importance);
}

function surfaceFor(importance: number, params: WorldParams): RoadSurface {
  const prosperity = frac(params.prosperity);
  const paved = importance * 0.72 + prosperity * 0.38;
  if (paved > 0.85) return 'stone';
  if (paved > 0.58) return 'cobble';
  if (paved > 0.36) return 'mixed';
  return 'dirt';
}

function addClearanceForEdge(clearances: ClearanceCorridor[], edge: RoadEdge): void {
  clearances.push({
    kind: edge.waterCrossing ? 'bridge' : 'road',
    points: edge.points,
    radius: edge.clearance,
  });
}

function findClosestNetworkNode(nodes: RoadNode[], p: Vec2): RoadNode {
  let best = nodes[0];
  let bestD = Infinity;
  for (const n of nodes) {
    const d = distance(n.position, p);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

function makeNode(id: string, demand: DemandNode): RoadNode {
  return {
    id,
    kind: demand.kind,
    position: demand.position,
    importance: demand.importance,
  };
}

function makeEdge(
  id: string,
  from: RoadNodeId,
  to: RoadNodeId,
  points: Vec2[],
  kind: RoadEdge['kind'],
  importance: number,
  params: WorldParams,
  crossing: WaterCrossing | null,
): RoadEdge {
  const width = edgeWidth(importance);
  return {
    id,
    from,
    to,
    points,
    kind,
    width,
    importance,
    clearance: width * 0.5 + 0.9,
    frontage: width * 0.5 + lerp(3.0, 2.0, frac(params.settlementPressure)),
    surface: surfaceFor(importance, params),
    waterCrossing: crossing,
  };
}

function generateDemandNodes(
  rng: Rng,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
  center: Vec2,
  settlementRadius: number,
): DemandNode[] {
  const settlement = frac(params.settlementPressure);
  const scale = frac(params.worldScale);
  const waterPresence = frac(params.waterPresence);
  const demands: DemandNode[] = [];

  const approachCount = 2 + Math.round(settlement * 1.5 + scale * 0.9);
  const baseAng = rng.range(0, Math.PI * 2);
  for (let a = 0; a < approachCount; a++) {
    const ang = baseAng + (a / approachCount) * Math.PI * 2 + rng.jitter(0.22);
    const rimR = terrain.half * rng.range(0.82, 0.98);
    demands.push({
      kind: 'gate',
      position: { x: Math.cos(ang) * rimR, z: Math.sin(ang) * rimR },
      importance: 0.82,
    });
  }

  const neighborhoodCount = Math.round(10 + settlement * 18 + scale * 5);
  for (let i = 0; i < neighborhoodCount; i++) {
    const ang = baseAng + rng.range(0, Math.PI * 2);
    const r = rng.range(settlementRadius * 0.32, settlementRadius * 0.96);
    const p = { x: center.x + Math.cos(ang) * r, z: center.z + Math.sin(ang) * r };
    if (Math.abs(p.x) > terrain.half * 0.92 || Math.abs(p.z) > terrain.half * 0.92) continue;
    if (isWater(terrain, water, p)) continue;
    demands.push({ kind: 'neighborhood', position: p, importance: lerp(0.28, 0.54, settlement) });
  }

  if (waterPresence > 0.35 && water.riverPath.length > 2) {
    const waterAccessCount = Math.min(4, Math.max(1, Math.round(waterPresence * 4)));
    for (let i = 0; i < waterAccessCount; i++) {
      const riverIndex = Math.floor(
        ((i + 1) / (waterAccessCount + 1)) * (water.riverPath.length - 1),
      );
      const p = water.riverPath[riverIndex];
      if (distance(p, center) > settlementRadius * 1.35) continue;
      demands.push({
        kind: 'waterAccess',
        position: p,
        importance: lerp(0.38, 0.68, waterPresence),
      });
    }
  }

  return demands;
}

function addPlazaClearance(clearances: ClearanceCorridor[], plaza: Plaza): void {
  clearances.push({ kind: 'plaza', points: [plaza.center], radius: plaza.radius + 1.2 });
}

export function generateRoads(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
  center: Vec2,
): RoadGraph {
  const rng = new Rng(seedValue).fork('roads');
  const settlement = frac(params.settlementPressure);
  const scale = frac(params.worldScale);
  const prosperity = frac(params.prosperity);
  const cost = buildCostField(seedValue, params, terrain, water);

  const settlementRadius = Math.min(
    terrain.half * 0.62,
    terrain.half * (0.26 + 0.34 * settlement) * (0.78 + 0.32 * scale),
  );

  const nodes: RoadNode[] = [
    {
      id: 'n-center',
      kind: 'center',
      position: center,
      importance: 1,
    },
  ];
  const edges: RoadEdge[] = [];
  const bridges: Bridge[] = [];
  const clearances: ClearanceCorridor[] = [];
  const junctions: Vec2[] = [center];
  const gateAnchors: Vec2[] = [];
  const plazas: Plaza[] = [];

  const demands = generateDemandNodes(rng, params, terrain, water, center, settlementRadius);
  let nodeSeq = 1;
  let edgeSeq = 0;

  for (const demand of demands) {
    const nearest = findClosestNetworkNode(nodes, demand.position);
    const pts = pathfind(terrain, cost, nearest.position, demand.position);
    const pathLen = polylineLength(pts);
    if (pathLen < 3.5 || pathLen > terrain.half * 1.8) continue;

    const node = makeNode(`n-${nodeSeq++}`, demand);
    const importance =
      demand.kind === 'gate'
        ? demand.importance
        : demand.kind === 'waterAccess'
          ? demand.importance
          : Math.max(
              0.22,
              demand.importance * (1 - distance(demand.position, center) / terrain.half),
            );
    const width = edgeWidth(importance);
    const crossing = waterCrossingFor(pts, terrain, water, width + 1.2);
    const kind: RoadEdge['kind'] =
      demand.kind === 'gate' ? 'approach' : importance > 0.48 ? 'street' : 'lane';

    const edge = makeEdge(
      `e-${edgeSeq++}`,
      nearest.id,
      node.id,
      pts,
      kind,
      crossing ? Math.max(importance, 0.62) : importance,
      params,
      crossing,
    );

    nodes.push(node);
    edges.push(edge);
    addClearanceForEdge(clearances, edge);
    junctions.push(node.position);
    if (demand.kind === 'gate') gateAnchors.push(demand.position);
    if (crossing) {
      bridges.push({
        a: crossing.a,
        b: crossing.b,
        deckLevel: crossing.deckLevel,
        width: crossing.width,
        hasHouse: bridges.length < 2 && frac(params.waterPresence) > 0.5 && rng.chance(prosperity),
      });
      const bridgeR = lerp(3.2, 5.6, prosperity);
      plazas.push({ center: crossing.a, radius: bridgeR, kind: 'bridge' });
      plazas.push({ center: crossing.b, radius: bridgeR, kind: 'bridge' });
    }
  }

  for (const p of plazas) addPlazaClearance(clearances, p);

  return {
    nodes,
    edges,
    plazas,
    bridges,
    clearances,
    gateAnchors,
    settlementRadius,
    junctions,
  };
}

export function addRoadGraphEdge(graph: RoadGraph, edge: RoadEdge): RoadGraph {
  return {
    ...graph,
    edges: [...graph.edges, edge],
    clearances: [
      ...graph.clearances,
      { kind: edge.waterCrossing ? 'bridge' : 'road', points: edge.points, radius: edge.clearance },
    ],
  };
}

export function nearestRoadPoint(
  graph: RoadGraph,
  p: Vec2,
): { point: Vec2; edge: RoadEdge; distance: number } {
  let best: { point: Vec2; edge: RoadEdge; distance: number } | undefined;
  for (const edge of graph.edges) {
    for (let i = 0; i < edge.points.length - 1; i++) {
      const point = closestPointOnSegment(p, edge.points[i], edge.points[i + 1]);
      const d = distance(p, point);
      if (!best || d < best.distance) best = { point, edge, distance: d };
    }
  }
  return best ?? { point: graph.nodes[0].position, edge: graph.edges[0], distance: Infinity };
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1e-6;
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + abx * t, z: a.z + abz * t };
}

export function distanceToRoadGraphClearance(graph: RoadGraph, p: Vec2): number {
  let best = Infinity;
  for (const c of graph.clearances) {
    if (c.points.length === 1) {
      best = Math.min(best, distance(p, c.points[0]) - c.radius);
      continue;
    }
    for (let i = 0; i < c.points.length - 1; i++) {
      best = Math.min(
        best,
        distance(p, closestPointOnSegment(p, c.points[i], c.points[i + 1])) - c.radius,
      );
    }
  }
  return best;
}

function polylineLength(pts: Vec2[]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += distance(pts[i], pts[i + 1]);
  return total;
}

void sampleHeight;
