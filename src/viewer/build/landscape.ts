/**
 * Landscape mesh builders: the terrain shell, the water surface (only over
 * water cells, depth-shaded), and the road/plaza ribbons that sit just above
 * the ground. All vertex-colored, all merged per layer for cheap drawing.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { idx, sampleHeight } from '../../generation/grid';
import type {
  Bridge,
  Plaza,
  RoadEdge,
  RoadSurface,
  TerrainData,
  Vec2,
  World,
} from '../../generation/types';
import { Mesher } from './mesher';
import { PALETTE, mix, shade, type RGB } from './palette';

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash2(a: number, b: number, salt: number): number {
  const x = Math.sin((a * 127.1 + b * 311.7 + salt * 74.7) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Terrain surface with smooth normals and height/slope/shore vertex colors. */
export function buildTerrainGeometry(world: World): BufferGeometry {
  const t = world.terrain;
  const n = t.size;
  const level = world.water.level;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const span = Math.max(1e-3, t.maxHeight - t.minHeight);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = idx(n, i, j);
      const h = t.heights[k];
      const x = -t.half + i * t.cellSize;
      const z = -t.half + j * t.cellSize;
      positions[k * 3] = x;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z;

      // Normal via central differences.
      const hl = t.heights[idx(n, Math.max(0, i - 1), j)];
      const hr = t.heights[idx(n, Math.min(n - 1, i + 1), j)];
      const hd = t.heights[idx(n, i, Math.max(0, j - 1))];
      const hu = t.heights[idx(n, i, Math.min(n - 1, j + 1))];
      const nx = hl - hr;
      const nz = hd - hu;
      const ny = 2 * t.cellSize;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[k * 3] = nx / len;
      normals[k * 3 + 1] = ny / len;
      normals[k * 3 + 2] = nz / len;

      const slope = Math.hypot(hr - hl, hu - hd) / (2 * t.cellSize);
      const heightNorm = (h - t.minHeight) / span;
      const c = terrainColor(h, heightNorm, slope, level);
      colors[k * 3] = c.r;
      colors[k * 3 + 1] = c.g;
      colors[k * 3 + 2] = c.b;
    }
  }

  // Indices.
  const indices: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = idx(n, i, j);
      const b = idx(n, i + 1, j);
      const c = idx(n, i, j + 1);
      const d = idx(n, i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

function terrainColor(h: number, heightNorm: number, slope: number, level: number): RGB {
  // Grass gradient by elevation.
  let c = mix(PALETTE.grassLow, PALETTE.grassHigh, heightNorm);
  c = mix(c, PALETTE.grassDry, Math.max(0, heightNorm - 0.6) * 1.2);
  // Rocky on steep slopes.
  const rockT = smooth01(0.4, 0.95, slope);
  c = mix(c, h > level + 6 ? PALETTE.rockDark : PALETTE.rock, rockT);
  // Sandy/muddy shoreline just above the water.
  const shoreT = smooth01(2.4, 0.2, h - level) * (1 - rockT);
  c = mix(c, PALETTE.sand, shoreT * 0.8);
  // Darker submerged bed below the water line.
  if (h < level) {
    const depth = smooth01(0, 4, level - h);
    const shallowBed = mix(PALETTE.sand, PALETTE.waterShore, 0.34);
    const deepBed = mix(PALETTE.soil, PALETTE.waterDeep, 0.48);
    c = mix(shallowBed, deepBed, depth);
  }
  return c;
}

/** Water surface limited to water cells, shaded by depth. */
export function buildWaterGeometry(world: World): BufferGeometry | null {
  const t = world.terrain;
  const n = t.size;
  const level = world.water.level;
  const m = new Mesher();
  const surfaceY = level + 0.08;
  let any = false;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      // A water quad if any corner is flagged water; this keeps narrow rivers continuous.
      const k00 = world.water.mask[idx(n, i, j)];
      const k10 = world.water.mask[idx(n, i + 1, j)];
      const k01 = world.water.mask[idx(n, i, j + 1)];
      const k11 = world.water.mask[idx(n, i + 1, j + 1)];
      if (!(k00 || k10 || k01 || k11)) continue;
      any = true;
      const x0 = -t.half + i * t.cellSize;
      const z0 = -t.half + j * t.cellSize;
      const x1 = x0 + t.cellSize;
      const z1 = z0 + t.cellSize;
      const depth = waterQuadDepth(world, i, j);
      const edge = isWaterEdgeCell(world, i, j) ? 1 : 0;
      const depthColor = mix(PALETTE.waterShallow, PALETTE.waterDeep, smooth01(0, 6, depth));
      const col = mix(depthColor, PALETTE.waterShore, edge * 0.22);
      m.quad(x0, surfaceY, z0, x1, surfaceY, z0, x1, surfaceY, z1, x0, surfaceY, z1, col);
    }
  }
  buildWaterSurfaceRims(m, world, surfaceY + 0.075);
  buildRiverFlowMarks(m, world, surfaceY + 0.06);
  buildStillWaterGlints(m, world, surfaceY + 0.07);
  if (!any) return null;
  return m.toGeometry();
}

function waterQuadDepth(world: World, i: number, j: number): number {
  const t = world.terrain;
  const n = t.size;
  let depth = 0;
  let count = 0;
  for (const [di, dj] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const ii = i + di;
    const jj = j + dj;
    const k = idx(n, ii, jj);
    if (!world.water.mask[k]) continue;
    depth += Math.max(0, world.water.level - t.heights[k]);
    count++;
  }
  return count > 0 ? depth / count : 0;
}

function isWaterEdgeCell(world: World, i: number, j: number): boolean {
  return (
    !isWaterCell(world, i - 1, j) ||
    !isWaterCell(world, i + 1, j) ||
    !isWaterCell(world, i, j - 1) ||
    !isWaterCell(world, i, j + 1)
  );
}

function waterAt(world: World, p: Vec2): boolean {
  const t = world.terrain;
  const i = Math.round((p.x + t.half) / t.cellSize);
  const j = Math.round((p.z + t.half) / t.cellSize);
  return isWaterCell(world, i, j);
}

function addSurfaceMark(
  m: Mesher,
  cx: number,
  y: number,
  cz: number,
  ux: number,
  uz: number,
  length: number,
  width: number,
  color: RGB,
): void {
  const len = Math.hypot(ux, uz) || 1;
  const ax = ux / len;
  const az = uz / len;
  const nx = -az;
  const nz = ax;
  const hl = length / 2;
  const hw = width / 2;
  m.quad(
    cx - ax * hl - nx * hw,
    y,
    cz - az * hl - nz * hw,
    cx + ax * hl - nx * hw,
    y,
    cz + az * hl - nz * hw,
    cx + ax * hl + nx * hw,
    y,
    cz + az * hl + nz * hw,
    cx - ax * hl + nx * hw,
    y,
    cz - az * hl + nz * hw,
    color,
  );
}

function buildRiverFlowMarks(m: Mesher, world: World, y: number): void {
  const pts = world.water.riverPath;
  if (pts.length < 2) return;
  const color = mix(PALETTE.waterHighlight, PALETTE.waterShore, 0.28);
  const spacing = Math.max(3.2, world.terrain.cellSize * 0.72);
  const width = Math.max(0.08, world.terrain.cellSize * 0.035);
  let carried = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    for (let d = spacing - carried; d < len; d += spacing) {
      const h = hash2(i, Math.floor(d * 4), 19);
      const lateral = (h - 0.5) * world.terrain.cellSize * 0.9;
      const cx = a.x + ux * d + nx * lateral;
      const cz = a.z + uz * d + nz * lateral;
      if (!waterAt(world, { x: cx, z: cz })) continue;
      const markLength = world.terrain.cellSize * (0.42 + hash2(i, Math.floor(d * 3), 41) * 0.28);
      addSurfaceMark(m, cx, y, cz, ux, uz, markLength, width, shade(color, 0.88 + h * 0.16));
    }
    carried = (carried + len) % spacing;
  }
}

function buildWaterSurfaceRims(m: Mesher, world: World, y: number): void {
  const t = world.terrain;
  const n = t.size;
  const c = t.cellSize;
  const rimWidth = Math.max(0.16, Math.min(0.48, c * 0.08));
  const color = mix(PALETTE.waterHighlight, PALETTE.waterShore, 0.36);

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (!isWaterCell(world, i, j)) continue;
      const x0 = -t.half + i * c;
      const z0 = -t.half + j * c;
      const x1 = x0 + c;
      const z1 = z0 + c;
      const shadeK = 0.82 + hash2(i, j, 117) * 0.14;

      if (!isWaterCell(world, i - 1, j)) {
        addSurfaceMark(
          m,
          x0 + rimWidth * 0.55,
          y,
          (z0 + z1) / 2,
          0,
          1,
          c,
          rimWidth,
          shade(color, shadeK),
        );
      }
      if (!isWaterCell(world, i + 1, j)) {
        addSurfaceMark(
          m,
          x1 - rimWidth * 0.55,
          y,
          (z0 + z1) / 2,
          0,
          1,
          c,
          rimWidth,
          shade(color, shadeK),
        );
      }
      if (!isWaterCell(world, i, j - 1)) {
        addSurfaceMark(
          m,
          (x0 + x1) / 2,
          y,
          z0 + rimWidth * 0.55,
          1,
          0,
          c,
          rimWidth,
          shade(color, shadeK),
        );
      }
      if (!isWaterCell(world, i, j + 1)) {
        addSurfaceMark(
          m,
          (x0 + x1) / 2,
          y,
          z1 - rimWidth * 0.55,
          1,
          0,
          c,
          rimWidth,
          shade(color, shadeK),
        );
      }
    }
  }
}

function buildStillWaterGlints(m: Mesher, world: World, y: number): void {
  const t = world.terrain;
  const n = t.size;
  const color = mix(PALETTE.waterHighlight, PALETTE.waterShallow, 0.34);
  const density = world.water.hasMoat ? 0.18 : 0.11;
  const length = Math.max(0.65, t.cellSize * 0.32);
  const width = Math.max(0.07, t.cellSize * 0.028);

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (!isWaterCell(world, i, j) || !isWaterEdgeCell(world, i, j)) continue;
      const h = hash2(i, j, 83);
      if (h > density) continue;
      const x = -t.half + (i + 0.5 + (hash2(i, j, 84) - 0.5) * 0.38) * t.cellSize;
      const z = -t.half + (j + 0.5 + (hash2(i, j, 85) - 0.5) * 0.38) * t.cellSize;
      const angle = hash2(i, j, 86) * Math.PI;
      addSurfaceMark(
        m,
        x,
        y,
        z,
        Math.cos(angle),
        Math.sin(angle),
        length * (0.75 + h * 0.5),
        width,
        shade(color, 0.86 + h * 0.18),
      );
    }
  }
}

/** Road, plaza, access and shoreline pavings, hugging the terrain a little above it. */
export function buildRoadGeometry(world: World): BufferGeometry | null {
  const t = world.terrain;
  const m = new Mesher();
  const prosperity = world.params.prosperity / 100;
  const waterPresence = world.params.waterPresence / 100;
  let any = false;

  if (buildShoreline(m, world, prosperity, waterPresence)) any = true;
  for (const bridge of world.roadGraph.bridges) {
    buildBridgeHead(m, t, bridge, prosperity);
    any = true;
  }
  for (const road of world.roadGraph.edges) {
    if (buildRibbon(m, t, road, prosperity)) any = true;
  }
  for (const plaza of world.roadGraph.plazas) {
    buildPlaza(m, t, plaza, prosperity);
    any = true;
  }
  if (!any) return null;
  return m.toGeometry();
}

function isWaterCell(world: World, i: number, j: number): boolean {
  const n = world.terrain.size;
  if (i < 0 || j < 0 || i >= n || j >= n) return false;
  return world.water.mask[idx(n, i, j)] === 1;
}

function buildShoreline(
  m: Mesher,
  world: World,
  prosperity: number,
  waterPresence: number,
): boolean {
  if (world.water.coverage <= 0) return false;
  const t = world.terrain;
  const n = t.size;
  const c = t.cellSize;
  const band = Math.max(0.28, Math.min(0.72, c * 0.14));
  const lift = 0.31;
  const sandColor = mix(PALETTE.sand, PALETTE.soil, 0.42);
  const stoneColor = mix(PALETTE.stoneDark, PALETTE.rock, 0.25 + prosperity * 0.18);
  const wetColor = mix(PALETTE.soil, PALETTE.waterShallow, 0.08 + waterPresence * 0.08);
  const rimColor = mix(PALETTE.waterShore, PALETTE.sand, 0.3 + prosperity * 0.14);
  const density = 0.42 + waterPresence * 0.18;
  let any = false;

  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const wet = isWaterCell(world, i, j);
      if (!wet) continue;
      const x0 = -t.half + i * c;
      const z0 = -t.half + j * c;
      const x1 = x0 + c;
      const z1 = z0 + c;
      const edgeColor = (i + j) % 3 === 0 && prosperity > 0.42 ? stoneColor : sandColor;

      if (!isWaterCell(world, i - 1, j)) {
        waterEdgeRim(m, world, x0 - band * 0.18, (z0 + z1) / 2, 0, c, band * 0.42, rimColor);
        any = true;
      }
      if (!isWaterCell(world, i - 1, j) && shoreHash(i, j, 0) < density) {
        shorePatch(m, t, x0 - band * 0.45, (z0 + z1) / 2, 0, c, band, lift, edgeColor, i, j, 0);
        any = true;
      }
      if (!isWaterCell(world, i + 1, j)) {
        waterEdgeRim(m, world, x1 + band * 0.18, (z0 + z1) / 2, 0, c, band * 0.42, rimColor);
        any = true;
      }
      if (!isWaterCell(world, i + 1, j) && shoreHash(i, j, 1) < density) {
        shorePatch(m, t, x1 + band * 0.45, (z0 + z1) / 2, 0, c, band, lift, edgeColor, i, j, 1);
        any = true;
      }
      if (!isWaterCell(world, i, j - 1)) {
        waterEdgeRim(
          m,
          world,
          (x0 + x1) / 2,
          z0 - band * 0.18,
          Math.PI / 2,
          c,
          band * 0.42,
          rimColor,
        );
        any = true;
      }
      if (!isWaterCell(world, i, j - 1) && shoreHash(i, j, 2) < density) {
        shorePatch(
          m,
          t,
          (x0 + x1) / 2,
          z0 - band * 0.45,
          Math.PI / 2,
          c,
          band,
          lift,
          wetColor,
          i,
          j,
          2,
        );
        any = true;
      }
      if (!isWaterCell(world, i, j + 1)) {
        waterEdgeRim(
          m,
          world,
          (x0 + x1) / 2,
          z1 + band * 0.18,
          Math.PI / 2,
          c,
          band * 0.42,
          rimColor,
        );
        any = true;
      }
      if (!isWaterCell(world, i, j + 1) && shoreHash(i, j, 3) < density) {
        shorePatch(
          m,
          t,
          (x0 + x1) / 2,
          z1 + band * 0.45,
          Math.PI / 2,
          c,
          band,
          lift,
          edgeColor,
          i,
          j,
          3,
        );
        any = true;
      }
    }
  }
  return any;
}

function shoreHash(i: number, j: number, salt: number): number {
  return hash2(i, j, salt);
}

function waterEdgeRim(
  m: Mesher,
  world: World,
  centerX: number,
  centerZ: number,
  rot: number,
  length: number,
  width: number,
  color: RGB,
): void {
  const y = world.water.level + 0.18;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const hx = length / 2;
  const hz = width / 2;
  const p = (lx: number, lz: number): Vec2 => ({
    x: centerX + lx * cos + lz * sin,
    z: centerZ - lx * sin + lz * cos,
  });
  const a = p(-hx, -hz);
  const b = p(hx, -hz);
  const c = p(hx, hz);
  const d = p(-hx, hz);
  m.quad(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, d.x, y, d.z, color);
}

function shorePatch(
  m: Mesher,
  t: TerrainData,
  centerX: number,
  centerZ: number,
  rot: number,
  cellSize: number,
  width: number,
  lift: number,
  color: RGB,
  i: number,
  j: number,
  salt: number,
): void {
  const length = cellSize * (0.22 + shoreHash(i, j, salt + 7) * 0.24);
  const inset = cellSize * (shoreHash(i, j, salt + 13) - 0.5) * 0.3;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = centerX + cos * inset;
  const cz = centerZ - sin * inset;
  const hx = length / 2;
  const hz = width / 2;
  const p = (lx: number, lz: number): Vec2 => ({
    x: cx + lx * cos + lz * sin,
    z: cz - lx * sin + lz * cos,
  });
  const a = p(-hx, -hz);
  const b = p(hx, -hz);
  const c = p(hx, hz);
  const d = p(-hx, hz);
  m.quad(
    a.x,
    sampleHeight(t, a.x, a.z) + lift,
    a.z,
    b.x,
    sampleHeight(t, b.x, b.z) + lift,
    b.z,
    c.x,
    sampleHeight(t, c.x, c.z) + lift,
    c.z,
    d.x,
    sampleHeight(t, d.x, d.z) + lift,
    d.z,
    color,
  );
}

function buildBridgeHead(m: Mesher, t: TerrainData, bridge: Bridge, prosperity: number): void {
  const dx = bridge.b.x - bridge.a.x;
  const dz = bridge.b.z - bridge.a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const ux = dx / len;
  const uz = dz / len;
  const rot = Math.atan2(dx, dz);
  const color = mix(PALETTE.stoneDark, PALETTE.stone, 0.32 + prosperity * 0.38);
  const apronColor = mix(PALETTE.roadDirt, PALETTE.roadCobble, 0.35 + prosperity * 0.35);
  const width = bridge.width + 1.4;
  const depth = Math.min(3.4, Math.max(1.8, bridge.width * 0.55));

  for (const [p, dir] of [
    [bridge.a, -1],
    [bridge.b, 1],
  ] as const) {
    const cx = p.x + ux * depth * 0.32 * dir;
    const cz = p.z + uz * depth * 0.32 * dir;
    const y = sampleHeight(t, p.x, p.z) + 0.48;
    m.box(cx, y, cz, width, 0.28, depth, rot, color);

    const approachCx = p.x + ux * depth * 0.92 * dir;
    const approachCz = p.z + uz * depth * 0.92 * dir;
    m.box(
      approachCx,
      sampleHeight(t, approachCx, approachCz) + 0.38,
      approachCz,
      bridge.width,
      0.12,
      depth * 1.15,
      rot,
      apronColor,
    );

    buildSettPatch(m, t, approachCx, approachCz, rot, bridge.width * 1.05, depth * 1.1, prosperity);
  }
}

function buildRibbon(m: Mesher, t: TerrainData, road: RoadEdge, prosperity: number): boolean {
  const pts = road.points;
  if (pts.length < 2) return false;
  const roadGrade = road.importance;
  const centerColor = roadSurfaceColor(road.surface, prosperity, roadGrade);
  const vergeColor = mix(PALETTE.soil, PALETTE.stoneDark, prosperity * 0.45 * roadGrade);
  const width = road.width;
  const centerWidth =
    width * (road.kind === 'access' ? 0.92 : road.importance < 0.35 ? 0.84 : 0.76);
  const edgeWidth = Math.max(0.12, Math.min(0.48, (width - centerWidth) / 2));
  const centerLift = 0.32;
  const edgeLift = 0.36;

  buildSurfaceRibbon(m, t, pts, centerWidth, 0, centerLift, centerColor);
  if (width > 1.5 && road.kind !== 'access') {
    const edgeOffset = centerWidth / 2 + edgeWidth / 2;
    buildSurfaceRibbon(m, t, pts, edgeWidth, edgeOffset, edgeLift, vergeColor);
    buildSurfaceRibbon(m, t, pts, edgeWidth, -edgeOffset, edgeLift, vergeColor);
  }

  if (road.surface === 'wood') {
    buildWoodPlanks(m, t, pts, centerWidth, road.importance);
  } else if (road.surface === 'stone' || road.surface === 'cobble') {
    buildRoadSetts(m, t, pts, centerWidth, prosperity, roadGrade, road.surface);
  } else if (road.surface === 'mixed') {
    buildRoadSetts(m, t, pts, centerWidth * 0.86, prosperity * 0.82, roadGrade * 0.72, 'mixed');
    buildDirtRoadMarks(m, t, pts, centerWidth, road.importance, prosperity);
  } else {
    buildDirtRoadMarks(m, t, pts, centerWidth, road.importance, prosperity);
  }
  return true;
}

function roadSurfaceColor(surface: RoadSurface, prosperity: number, importance: number): RGB {
  switch (surface) {
    case 'stone':
      return mix(PALETTE.roadCobble, PALETTE.stone, 0.24 + prosperity * 0.18);
    case 'cobble':
      return mix(PALETTE.roadDirt, PALETTE.roadCobble, 0.46 + prosperity * 0.2);
    case 'mixed':
      return mix(PALETTE.roadDirt, PALETTE.roadCobble, 0.34 + importance * 0.2);
    case 'wood':
      return mix(PALETTE.wood, PALETTE.timber, 0.35);
    case 'dirt':
      return mix(PALETTE.soil, PALETTE.roadDirt, 0.55);
  }
}

function buildSurfaceRibbon(
  m: Mesher,
  t: TerrainData,
  pts: Vec2[],
  width: number,
  offset: number,
  lift: number,
  color: RGB,
): boolean {
  if (pts.length < 2 || width <= 0.02) return false;
  const hw = width / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const cx = pts[i].x + nx * offset;
    const cz = pts[i].z + nz * offset;
    left.push({ x: cx + nx * hw, z: cz + nz * hw });
    right.push({ x: cx - nx * hw, z: cz - nz * hw });
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = left[i],
      l1 = left[i + 1];
    const r0 = right[i],
      r1 = right[i + 1];
    const yl0 = sampleHeight(t, l0.x, l0.z) + lift;
    const yl1 = sampleHeight(t, l1.x, l1.z) + lift;
    const yr0 = sampleHeight(t, r0.x, r0.z) + lift;
    const yr1 = sampleHeight(t, r1.x, r1.z) + lift;
    m.quad(l0.x, yl0, l0.z, r0.x, yr0, r0.z, r1.x, yr1, r1.z, l1.x, yl1, l1.z, color);
  }
  return true;
}

function buildRoadSetts(
  m: Mesher,
  t: TerrainData,
  pts: Vec2[],
  width: number,
  prosperity: number,
  roadGrade: number,
  surface: RoadSurface,
): void {
  const baseColor =
    surface === 'stone'
      ? mix(PALETTE.roadCobble, PALETTE.stoneDark, 0.16 + prosperity * 0.12)
      : surface === 'mixed'
        ? mix(PALETTE.roadDirt, PALETTE.roadCobble, 0.54)
        : mix(PALETTE.roadCobble, PALETTE.stoneDark, 0.34);
  const cellLen = surface === 'mixed' ? 1.25 : 0.82 - prosperity * 0.18;
  const rowGap = surface === 'mixed' ? 0.78 : 0.56 - prosperity * 0.08;
  const rows: number[] = [];
  const half = width * 0.43;
  for (let off = -half; off <= half + 0.01; off += rowGap) rows.push(off);
  let carried = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;

    for (let d = cellLen - carried; d < len; d += cellLen) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const skip = surface === 'mixed' && settHash(i, rowIndex, Math.floor(d * 3)) > 0.58;
        if (skip) continue;
        const hash = settHash(i, rowIndex, Math.floor(d * 5));
        const rowOffset = rows[rowIndex] + (hash - 0.5) * rowGap * 0.26;
        if (Math.abs(rowOffset) > half) continue;
        const alongOffset =
          (rowIndex % 2 === 0 ? 0 : cellLen * 0.45) + (hash - 0.5) * cellLen * 0.2;
        const along = Math.min(len - 0.05, Math.max(0.05, d + alongOffset));
        const stoneLen = cellLen * (0.66 + hash * 0.32);
        const stoneHalfWidth = rowGap * (0.36 + settHash(rowIndex, i, Math.floor(d * 7)) * 0.14);
        const cx = a.x + ux * along + nx * rowOffset;
        const cz = a.z + uz * along + nz * rowOffset;
        const p0 = {
          x: cx - ux * stoneLen * 0.5 - nx * stoneHalfWidth,
          z: cz - uz * stoneLen * 0.5 - nz * stoneHalfWidth,
        };
        const p1 = {
          x: cx - ux * stoneLen * 0.5 + nx * stoneHalfWidth,
          z: cz - uz * stoneLen * 0.5 + nz * stoneHalfWidth,
        };
        const p2 = {
          x: cx + ux * stoneLen * 0.5 + nx * stoneHalfWidth,
          z: cz + uz * stoneLen * 0.5 + nz * stoneHalfWidth,
        };
        const p3 = {
          x: cx + ux * stoneLen * 0.5 - nx * stoneHalfWidth,
          z: cz + uz * stoneLen * 0.5 - nz * stoneHalfWidth,
        };
        const lift = surface === 'mixed' ? 0.43 : 0.46;
        const color =
          rowIndex % 2 === 0
            ? shade(baseColor, 0.86 + hash * 0.2)
            : shade(baseColor, 0.78 + hash * 0.18);
        m.quad(
          p0.x,
          sampleHeight(t, p0.x, p0.z) + lift,
          p0.z,
          p1.x,
          sampleHeight(t, p1.x, p1.z) + lift,
          p1.z,
          p2.x,
          sampleHeight(t, p2.x, p2.z) + lift,
          p2.z,
          p3.x,
          sampleHeight(t, p3.x, p3.z) + lift,
          p3.z,
          color,
        );
      }
    }
    carried = (carried + len) % cellLen;
  }

  if (roadGrade > 0.62) {
    buildSurfaceRibbon(m, t, pts, 0.18, half + 0.09, 0.5, shade(baseColor, 0.76));
    buildSurfaceRibbon(m, t, pts, 0.18, -half - 0.09, 0.5, shade(baseColor, 0.76));
  }
}

function buildDirtRoadMarks(
  m: Mesher,
  t: TerrainData,
  pts: Vec2[],
  width: number,
  importance: number,
  prosperity: number,
): void {
  const rutColor = mix(PALETTE.soil, PALETTE.roadDirt, 0.28);
  const stoneColor = mix(PALETTE.roadCobble, PALETTE.sand, 0.22);
  const rutOffset = Math.max(0.32, width * 0.24);
  const rutWidth = Math.max(0.16, width * 0.08);
  buildSurfaceRibbon(m, t, pts, rutWidth, rutOffset, 0.39, shade(rutColor, 0.74));
  buildSurfaceRibbon(m, t, pts, rutWidth, -rutOffset, 0.39, shade(rutColor, 0.78));
  if (importance + prosperity < 0.62) return;

  let carried = 0;
  const spacing = 3.2 - importance * 1.1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    for (let d = spacing - carried; d < len; d += spacing) {
      const h = settHash(i, Math.floor(d * 2), 91);
      if (h > 0.55 + prosperity * 0.2) continue;
      const lateral = (h - 0.5) * width * 0.45;
      const stoneLen = 0.46 + h * 0.22;
      const stoneWidth = 0.22 + settHash(i, Math.floor(d * 4), 32) * 0.16;
      const cx = a.x + ux * d + nx * lateral;
      const cz = a.z + uz * d + nz * lateral;
      const p0 = {
        x: cx - ux * stoneLen - nx * stoneWidth,
        z: cz - uz * stoneLen - nz * stoneWidth,
      };
      const p1 = {
        x: cx - ux * stoneLen + nx * stoneWidth,
        z: cz - uz * stoneLen + nz * stoneWidth,
      };
      const p2 = {
        x: cx + ux * stoneLen + nx * stoneWidth,
        z: cz + uz * stoneLen + nz * stoneWidth,
      };
      const p3 = {
        x: cx + ux * stoneLen - nx * stoneWidth,
        z: cz + uz * stoneLen - nz * stoneWidth,
      };
      m.quad(
        p0.x,
        sampleHeight(t, p0.x, p0.z) + 0.44,
        p0.z,
        p1.x,
        sampleHeight(t, p1.x, p1.z) + 0.44,
        p1.z,
        p2.x,
        sampleHeight(t, p2.x, p2.z) + 0.44,
        p2.z,
        p3.x,
        sampleHeight(t, p3.x, p3.z) + 0.44,
        p3.z,
        shade(stoneColor, 0.82 + h * 0.18),
      );
    }
    carried = (carried + len) % spacing;
  }
}

function buildWoodPlanks(
  m: Mesher,
  t: TerrainData,
  pts: Vec2[],
  width: number,
  importance: number,
): void {
  const plankColor = mix(PALETTE.wood, PALETTE.timber, 0.38);
  const spacing = 0.9;
  let carried = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    for (let d = spacing - carried; d < len; d += spacing) {
      const h = settHash(i, Math.floor(d * 3), 17);
      const cx = a.x + ux * d;
      const cz = a.z + uz * d;
      const plankDepth = 0.16 + importance * 0.08;
      const plankHalf = width * (0.38 + h * 0.04);
      const p0 = {
        x: cx - ux * plankDepth - nx * plankHalf,
        z: cz - uz * plankDepth - nz * plankHalf,
      };
      const p1 = {
        x: cx - ux * plankDepth + nx * plankHalf,
        z: cz - uz * plankDepth + nz * plankHalf,
      };
      const p2 = {
        x: cx + ux * plankDepth + nx * plankHalf,
        z: cz + uz * plankDepth + nz * plankHalf,
      };
      const p3 = {
        x: cx + ux * plankDepth - nx * plankHalf,
        z: cz + uz * plankDepth - nz * plankHalf,
      };
      m.quad(
        p0.x,
        sampleHeight(t, p0.x, p0.z) + 0.49,
        p0.z,
        p1.x,
        sampleHeight(t, p1.x, p1.z) + 0.49,
        p1.z,
        p2.x,
        sampleHeight(t, p2.x, p2.z) + 0.49,
        p2.z,
        p3.x,
        sampleHeight(t, p3.x, p3.z) + 0.49,
        p3.z,
        shade(plankColor, 0.78 + h * 0.22),
      );
    }
    carried = (carried + len) % spacing;
  }
}

function buildSettPatch(
  m: Mesher,
  t: TerrainData,
  cx: number,
  cz: number,
  rot: number,
  width: number,
  depth: number,
  prosperity: number,
): void {
  const cols = Math.max(2, Math.round(width / 0.62));
  const rows = Math.max(2, Math.round(depth / 0.72));
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const color = mix(PALETTE.roadCobble, PALETTE.stoneDark, 0.2 + prosperity * 0.16);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = settHash(r, c, Math.floor((cx + cz) * 10));
      const lx = -width / 2 + ((c + 0.5) / cols) * width + (h - 0.5) * 0.14;
      const lz = -depth / 2 + ((r + 0.5) / rows) * depth;
      const sx = (width / cols) * (0.72 + h * 0.12);
      const sz = (depth / rows) * (0.7 + settHash(c, r, 44) * 0.16);
      const p = (x: number, z: number): Vec2 => ({
        x: cx + x * cos + z * sin,
        z: cz - x * sin + z * cos,
      });
      const p0 = p(lx - sx / 2, lz - sz / 2);
      const p1 = p(lx + sx / 2, lz - sz / 2);
      const p2 = p(lx + sx / 2, lz + sz / 2);
      const p3 = p(lx - sx / 2, lz + sz / 2);
      m.quad(
        p0.x,
        sampleHeight(t, p0.x, p0.z) + 0.51,
        p0.z,
        p1.x,
        sampleHeight(t, p1.x, p1.z) + 0.51,
        p1.z,
        p2.x,
        sampleHeight(t, p2.x, p2.z) + 0.51,
        p2.z,
        p3.x,
        sampleHeight(t, p3.x, p3.z) + 0.51,
        p3.z,
        shade(color, 0.8 + h * 0.18),
      );
    }
  }
}

function settHash(a: number, b: number, salt: number): number {
  const x = Math.sin((a * 127.1 + b * 311.7 + salt * 74.7) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildPlaza(m: Mesher, t: TerrainData, plaza: Plaza, prosperity: number): void {
  const baseColor =
    plaza.kind === 'civic' || plaza.kind === 'market'
      ? mix(PALETTE.plaza, PALETTE.roadCobble, 0.3)
      : mix(PALETTE.roadDirt, PALETTE.plaza, prosperity);
  const centerColor = mix(baseColor, PALETTE.sand, plaza.kind === 'courtyard' ? 0.2 : 0.05);
  const ringColor = mix(baseColor, PALETTE.stoneDark, 0.2 + prosperity * 0.25);
  const curbColor = mix(PALETTE.stoneDark, PALETTE.stone, 0.25 + prosperity * 0.45);
  const segs = plaza.kind === 'civic' || plaza.kind === 'market' ? 22 : 16;
  const cx = plaza.center.x;
  const cz = plaza.center.z;
  const innerRadius =
    plaza.radius * (plaza.kind === 'gate' || plaza.kind === 'bridge' ? 0.58 : 0.72);
  const curbOuter = plaza.radius + Math.min(0.45, plaza.radius * 0.08);
  const curbInner = plaza.radius + Math.min(0.16, plaza.radius * 0.03);
  const cy = sampleHeight(t, cx, cz) + 0.3;
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const inner0 = pointOnCircle(cx, cz, innerRadius, a0);
    const inner1 = pointOnCircle(cx, cz, innerRadius, a1);
    const outer0 = pointOnCircle(cx, cz, plaza.radius, a0);
    const outer1 = pointOnCircle(cx, cz, plaza.radius, a1);
    const curb0 = pointOnCircle(cx, cz, curbInner, a0);
    const curb1 = pointOnCircle(cx, cz, curbInner, a1);
    const curb2 = pointOnCircle(cx, cz, curbOuter, a1);
    const curb3 = pointOnCircle(cx, cz, curbOuter, a0);
    const wedgeColor = s % 2 === 0 ? centerColor : shade(centerColor, 0.94);
    m.triangle(
      cx,
      cy,
      cz,
      inner0.x,
      sampleHeight(t, inner0.x, inner0.z) + 0.3,
      inner0.z,
      inner1.x,
      sampleHeight(t, inner1.x, inner1.z) + 0.3,
      inner1.z,
      wedgeColor,
    );
    m.quad(
      inner0.x,
      sampleHeight(t, inner0.x, inner0.z) + 0.32,
      inner0.z,
      outer0.x,
      sampleHeight(t, outer0.x, outer0.z) + 0.32,
      outer0.z,
      outer1.x,
      sampleHeight(t, outer1.x, outer1.z) + 0.32,
      outer1.z,
      inner1.x,
      sampleHeight(t, inner1.x, inner1.z) + 0.32,
      inner1.z,
      s % 2 === 0 ? ringColor : shade(ringColor, 0.92),
    );
    m.quad(
      curb0.x,
      sampleHeight(t, curb0.x, curb0.z) + 0.4,
      curb0.z,
      curb3.x,
      sampleHeight(t, curb3.x, curb3.z) + 0.4,
      curb3.z,
      curb2.x,
      sampleHeight(t, curb2.x, curb2.z) + 0.4,
      curb2.z,
      curb1.x,
      sampleHeight(t, curb1.x, curb1.z) + 0.4,
      curb1.z,
      curbColor,
    );
  }
}

function pointOnCircle(cx: number, cz: number, radius: number, angle: number): Vec2 {
  return {
    x: cx + Math.cos(angle) * radius,
    z: cz + Math.sin(angle) * radius,
  };
}
