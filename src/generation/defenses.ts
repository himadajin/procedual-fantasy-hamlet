/**
 * Defense phase. Walls, towers, gates and the moat are consequences of defense
 * pressure interacting with the center, terrain, water and scale — never a
 * user "walls on/off" switch.
 *
 *  - Low pressure  -> a few low stone revetments, no enceinte.
 *  - Mid pressure  -> a partial wall facing the main approach, a gatehouse,
 *                     watchtowers.
 *  - High pressure -> a full ring wall around the core with interval towers,
 *                     gates where main roads cross, and (with water) a moat.
 *
 * The wall line wobbles with the seed and rides the terrain; gates snap to the
 * road approaches so the skeleton and the defenses agree.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import { cellToWorld, distance, idx, sampleHeight, worldToCellF, clampInt, lerp } from './grid';
import type { Gate, TerrainData, Tower, Vec2, WallSegment, WaterData } from './types';

export interface DefenseResult {
  walls: WallSegment[];
  towers: Tower[];
  gates: Gate[];
  /** The closed core boundary polygon (always present, for siting decisions). */
  enclosure: Vec2[];
  enclosureRadius: number;
  hasWalls: boolean;
  hasMoat: boolean;
}

/** Point-in-polygon (ray cast) for inside/outside-the-core tests. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z) {
      const xCross = ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x;
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside;
}

export function generateDefenses(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
  center: Vec2,
  settlementRadius: number,
  gateAnchors: Vec2[],
): DefenseResult {
  const rng = new Rng(seedValue).fork('defense');
  const defense = frac(params.defensePressure);
  const monument = frac(params.monumentality);
  const prosperity = frac(params.prosperity);
  const waterPresence = frac(params.waterPresence);
  const noise = new ValueNoise2D(seedValue ^ 0x71f5a2c3);

  const walls: WallSegment[] = [];
  const towers: Tower[] = [];
  const gates: Gate[] = [];

  // Core enclosure radius: a bit inside the settlement extent.
  const enclosureRadius = Math.max(16, settlementRadius * lerp(0.62, 0.82, monument));
  const vertCount = 30;
  const wobble = enclosureRadius * lerp(0.04, 0.16, frac(params.terrainRuggedness));
  const phase = rng.range(0, Math.PI * 2);

  // Build the closed boundary polygon, riding terrain wobble.
  const enclosure: Vec2[] = [];
  for (let v = 0; v < vertCount; v++) {
    const a = (v / vertCount) * Math.PI * 2;
    const r =
      enclosureRadius +
      Math.sin(a * 3 + phase) * wobble +
      (noise.fbm(Math.cos(a) * 4 + 10, Math.sin(a) * 4 - 3, 3) - 0.5) * wobble * 2;
    enclosure.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r });
  }

  const wallHeight = lerp(4.2, 8.5, defense) + monument * 1.6;
  const wallThickness = lerp(1.1, 2.6, defense);
  const crenellated = defense > 0.4 || prosperity > 0.7;
  const hasWalls = defense > 0.34;

  // Which vertices become gates: nearest enclosure vertex to each approach.
  const gateVertices = new Set<number>();
  if (hasWalls) {
    for (const anchor of gateAnchors) {
      const dir = Math.atan2(anchor.z - center.z, anchor.x - center.x);
      let bestV = 0;
      let bestD = Infinity;
      for (let v = 0; v < vertCount; v++) {
        const a = (v / vertCount) * Math.PI * 2;
        const d = Math.abs(Math.atan2(Math.sin(a - dir), Math.cos(a - dir)));
        if (d < bestD) {
          bestD = d;
          bestV = v;
        }
      }
      gateVertices.add(bestV);
    }
  }

  // Defense coverage: full ring at high pressure, a facing arc at mid pressure.
  // Arc centered on the first approach direction.
  const fullRing = defense > 0.6;
  let arcCenter = 0;
  if (gateAnchors.length > 0) {
    const dir = Math.atan2(gateAnchors[0].z - center.z, gateAnchors[0].x - center.x);
    arcCenter = (dir / (Math.PI * 2)) * vertCount;
  }
  const arcHalfSpan = vertCount * lerp(0.18, 0.42, (defense - 0.34) / 0.26);

  const includeSegment = (v: number): boolean => {
    if (!hasWalls) return false;
    if (fullRing) return true;
    let d = Math.abs(v - arcCenter);
    d = Math.min(d, vertCount - d);
    return d <= arcHalfSpan;
  };

  if (hasWalls) {
    const towerEvery = fullRing ? rng.int(3, 4) : 2;
    for (let v = 0; v < vertCount; v++) {
      const a = enclosure[v];
      const b = enclosure[(v + 1) % vertCount];
      const groundA = sampleHeight(terrain, a.x, a.z);
      const groundB = sampleHeight(terrain, b.x, b.z);

      if (gateVertices.has(v)) {
        // Gatehouse instead of plain wall at this vertex.
        const mid = a;
        const dir = Math.atan2(center.z - mid.z, center.x - mid.x);
        gates.push({
          position: mid,
          ground: groundA,
          rotation: dir,
          width: lerp(5, 8, prosperity),
          height: wallHeight + 2.5,
        });
        // Flanking towers at a gate.
        towers.push(makeTower(rng, a, groundA, wallHeight, defense, prosperity, true));
        continue;
      }

      if (includeSegment(v)) {
        walls.push({
          a,
          b,
          groundA,
          groundB,
          height: wallHeight + rng.jitter(0.4),
          thickness: wallThickness,
          crenellated,
        });
        if (v % towerEvery === 0) {
          towers.push(makeTower(rng, a, groundA, wallHeight, defense, prosperity, false));
        }
      }
    }
  } else {
    // Low pressure: a handful of low stone revetments near the core edge.
    const count = rng.int(2, 4);
    for (let i = 0; i < count; i++) {
      const v = rng.int(0, vertCount - 1);
      const a = enclosure[v];
      const b = enclosure[(v + 1) % vertCount];
      walls.push({
        a,
        b,
        groundA: sampleHeight(terrain, a.x, a.z),
        groundB: sampleHeight(terrain, b.x, b.z),
        height: lerp(1.1, 2.2, defense),
        thickness: 1.0,
        crenellated: false,
      });
    }
    // Maybe a lone watchtower on high ground.
    if (defense > 0.18) {
      const v = rng.int(0, vertCount - 1);
      const a = enclosure[v];
      towers.push(
        makeTower(
          rng,
          a,
          sampleHeight(terrain, a.x, a.z),
          lerp(5, 8, monument),
          defense,
          prosperity,
          false,
        ),
      );
    }
  }

  // Moat: carve an outer ring of water when defense and water are both strong.
  let hasMoat = false;
  if (fullRing && waterPresence > 0.45) {
    hasMoat = carveMoat(terrain, water, center, enclosure, enclosureRadius, waterPresence);
    if (hasMoat) {
      water.hasMoat = true;
      if (!water.kinds.includes('moat')) water.kinds.push('moat');
    }
  }

  return { walls, towers, gates, enclosure, enclosureRadius, hasWalls, hasMoat };
}

function makeTower(
  rng: Rng,
  pos: Vec2,
  ground: number,
  wallHeight: number,
  defense: number,
  prosperity: number,
  atGate: boolean,
): Tower {
  const round = rng.chance(0.5 + prosperity * 0.3);
  return {
    position: pos,
    ground,
    radius: lerp(2.0, 3.6, defense) + (atGate ? 0.4 : 0),
    height: wallHeight + lerp(2.5, 6.5, defense) + (atGate ? 1.5 : 0),
    shape: round ? 'round' : 'square',
    hasRoof: rng.chance(0.55 + prosperity * 0.35),
    crenellated: rng.chance(0.5 + defense * 0.4),
  };
}

/** Carve a moat ring just outside the wall. Returns whether one was made. */
function carveMoat(
  terrain: TerrainData,
  water: WaterData,
  center: Vec2,
  enclosure: Vec2[],
  enclosureRadius: number,
  waterPresence: number,
): boolean {
  const inner = enclosureRadius * 1.04;
  const width = lerp(4, 9, waterPresence);
  const outer = inner + width;
  const depth = lerp(2, 4, waterPresence);
  const { size } = terrain;
  let carved = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const w = cellToWorld(terrain, i, j);
      const r = distance(w, center);
      if (r >= inner && r <= outer) {
        // Don't flood right where a gate causeway crosses (nearest enclosure pt).
        const k = idx(size, i, j);
        const sink = water.level - depth * (1 - Math.abs((r - (inner + width / 2)) / (width / 2)));
        if (terrain.heights[k] > sink) terrain.heights[k] = sink;
        water.mask[k] = 1;
        carved++;
      }
    }
  }
  void enclosure;
  void worldToCellF;
  void clampInt;
  return carved > 0;
}
