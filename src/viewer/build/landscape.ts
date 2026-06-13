/**
 * Landscape mesh builders: the terrain shell, the water surface (only over
 * water cells, depth-shaded), and the road/plaza ribbons that sit just above
 * the ground. All vertex-colored, all merged per layer for cheap drawing.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import { idx, sampleHeight } from '../../generation/grid';
import type {
  BuildingAccess,
  Plaza,
  RoadSegment,
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
    c = mix(mix(c, PALETTE.soil, 0.6), shade(PALETTE.soil, 0.6), depth);
  }
  return c;
}

/** Water surface limited to water cells, shaded by depth. */
export function buildWaterGeometry(world: World): BufferGeometry | null {
  const t = world.terrain;
  const n = t.size;
  const level = world.water.level;
  const m = new Mesher();
  const surfaceY = level + 0.04;
  let any = false;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      // A water quad if all four corners are flagged water.
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
      const depth = level - t.heights[idx(n, i, j)];
      const col = mix(PALETTE.waterShallow, PALETTE.waterDeep, smooth01(0, 5, depth));
      m.quad(x0, surfaceY, z0, x1, surfaceY, z0, x1, surfaceY, z1, x0, surfaceY, z1, col);
    }
  }
  if (!any) return null;
  return m.toGeometry();
}

/** Road ribbons and plaza pavings, hugging the terrain a little above it. */
export function buildRoadGeometry(world: World): BufferGeometry | null {
  const t = world.terrain;
  const m = new Mesher();
  const prosperity = world.params.prosperity / 100;
  let any = false;

  for (const road of world.roads) {
    if (buildRibbon(m, t, road, prosperity)) any = true;
  }
  for (const plaza of world.plazas) {
    buildPlaza(m, t, plaza, prosperity);
    any = true;
  }
  for (const access of world.accesses) {
    buildAccess(m, t, access, prosperity);
    any = true;
  }
  if (!any) return null;
  return m.toGeometry();
}

function buildRibbon(m: Mesher, t: TerrainData, road: RoadSegment, prosperity: number): boolean {
  const pts = road.points;
  if (pts.length < 2) return false;
  const roadGrade = road.klass === 'main' ? 1 : road.klass === 'street' ? 0.68 : 0.35;
  const centerColor = mix(PALETTE.roadDirt, PALETTE.roadCobble, prosperity * roadGrade);
  const vergeColor = mix(PALETTE.soil, PALETTE.stoneDark, prosperity * 0.45 * roadGrade);
  const centerWidth = road.width * (road.klass === 'lane' ? 0.84 : 0.76);
  const edgeWidth = Math.max(0.18, Math.min(0.48, (road.width - centerWidth) / 2));
  const centerLift = 0.32;
  const edgeLift = 0.36;

  buildSurfaceRibbon(m, t, pts, centerWidth, 0, centerLift, centerColor);
  if (road.width > 1.5) {
    const edgeOffset = centerWidth / 2 + edgeWidth / 2;
    buildSurfaceRibbon(m, t, pts, edgeWidth, edgeOffset, edgeLift, vergeColor);
    buildSurfaceRibbon(m, t, pts, edgeWidth, -edgeOffset, edgeLift, vergeColor);
  }
  if (prosperity > 0.35 && road.klass !== 'lane') {
    buildRoadSetts(m, t, pts, centerWidth, prosperity, roadGrade);
  }
  return true;
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
): void {
  const color = mix(PALETTE.roadCobble, PALETTE.stoneDark, 0.28);
  const spacing = 2.7 - prosperity * 0.75;
  const stoneDepth = 0.18 + prosperity * 0.05;
  const stoneHalfWidth = Math.min(0.16, width * 0.055);
  const rows = roadGrade > 0.85 ? [-0.28, 0, 0.28] : [-0.2, 0.2];
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
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const rowOffset = rows[rowIndex] * width * roadGrade;
        const alongOffset = rowIndex % 2 === 0 ? 0 : spacing * 0.35;
        const along = Math.min(len - 0.05, d + alongOffset);
        const cx = a.x + ux * along + nx * rowOffset;
        const cz = a.z + uz * along + nz * rowOffset;
        const p0 = {
          x: cx - ux * stoneDepth - nx * stoneHalfWidth,
          z: cz - uz * stoneDepth - nz * stoneHalfWidth,
        };
        const p1 = {
          x: cx - ux * stoneDepth + nx * stoneHalfWidth,
          z: cz - uz * stoneDepth + nz * stoneHalfWidth,
        };
        const p2 = {
          x: cx + ux * stoneDepth + nx * stoneHalfWidth,
          z: cz + uz * stoneDepth + nz * stoneHalfWidth,
        };
        const p3 = {
          x: cx + ux * stoneDepth - nx * stoneHalfWidth,
          z: cz + uz * stoneDepth - nz * stoneHalfWidth,
        };
        const lift = 0.42;
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
          rowIndex % 2 === 0 ? color : shade(color, 0.88),
        );
      }
    }
    carried = (carried + len) % spacing;
  }
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

function accessColor(access: BuildingAccess, prosperity: number): RGB {
  switch (access.material) {
    case 'stone':
      return mix(PALETTE.plaza, PALETTE.stone, 0.55 + prosperity * 0.25);
    case 'cobble':
      return mix(PALETTE.roadDirt, PALETTE.roadCobble, 0.55 + prosperity * 0.3);
    case 'wood':
      return mix(PALETTE.wood, PALETTE.timber, 0.35);
    case 'dirt':
      return mix(PALETTE.soil, PALETTE.roadDirt, 0.45);
  }
}

function buildAccess(m: Mesher, t: TerrainData, access: BuildingAccess, prosperity: number): void {
  const dx = access.end.x - access.start.x;
  const dz = access.end.z - access.start.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;

  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const color = accessColor(access, prosperity);
  const halfW = access.width / 2;
  const lift = access.material === 'wood' ? 0.42 : 0.36;
  const segments = Math.max(1, Math.ceil(len / 2.2));

  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    const c0 = {
      x: access.start.x + dx * t0,
      z: access.start.z + dz * t0,
    };
    const c1 = {
      x: access.start.x + dx * t1,
      z: access.start.z + dz * t1,
    };
    const l0 = { x: c0.x + nx * halfW, z: c0.z + nz * halfW };
    const r0 = { x: c0.x - nx * halfW, z: c0.z - nz * halfW };
    const l1 = { x: c1.x + nx * halfW, z: c1.z + nz * halfW };
    const r1 = { x: c1.x - nx * halfW, z: c1.z - nz * halfW };
    m.quad(
      l0.x,
      sampleHeight(t, l0.x, l0.z) + lift,
      l0.z,
      r0.x,
      sampleHeight(t, r0.x, r0.z) + lift,
      r0.z,
      r1.x,
      sampleHeight(t, r1.x, r1.z) + lift,
      r1.z,
      l1.x,
      sampleHeight(t, l1.x, l1.z) + lift,
      l1.z,
      color,
    );
  }

  const padDepth = Math.min(1.45, Math.max(0.8, access.width * 0.9));
  const padWidth = access.width * 1.45;
  const padCx = access.start.x + ux * padDepth * 0.28;
  const padCz = access.start.z + uz * padDepth * 0.28;
  const padY = sampleHeight(t, access.start.x, access.start.z) + lift + 0.04;
  m.box(padCx, padY, padCz, padWidth, 0.16, padDepth, Math.atan2(ux, uz), color);

  const apronWidth = access.width * (access.kind === 'water' ? 1.5 : 1.25);
  const apronDepth = Math.min(1.2, Math.max(0.55, access.width * 0.65));
  const apronCx = access.end.x - ux * apronDepth * 0.3;
  const apronCz = access.end.z - uz * apronDepth * 0.3;
  const apronColor = mix(color, access.kind === 'water' ? PALETTE.wood : PALETTE.plaza, 0.35);
  m.box(
    apronCx,
    sampleHeight(t, apronCx, apronCz) + lift + 0.02,
    apronCz,
    apronWidth,
    0.12,
    apronDepth,
    Math.atan2(ux, uz),
    apronColor,
  );
}
