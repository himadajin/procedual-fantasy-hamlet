/**
 * Settlement phase — the monument, plazas and all buildings.
 *
 * Buildings are not scattered: candidates are spawned along the road skeleton
 * (set back on each side, facing the street), around plazas (facing in) and
 * along the shore (facing the water). Each candidate is accepted or rejected by
 * a density that peaks at the center and fades outward, scaled by settlement
 * pressure. Role falls out of context — proximity to walls, gates, water,
 * bridges and the center — and drives footprint, massing, roof, material and
 * detail. The single monument is placed first and dominates.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import {
  cellToWorld,
  distance,
  idx,
  lerp,
  sampleHeight,
  slopeAt,
  smoothstep,
  worldToCellF,
  clampInt,
} from './grid';
import { pointInPolygon } from './defenses';
import type {
  Bridge,
  Building,
  BuildingRole,
  Gate,
  Plaza,
  RoadSegment,
  RoofKind,
  TerrainData,
  Vec2,
  WallMaterial,
  WaterData,
} from './types';

export interface SettlementResult {
  buildings: Building[];
  plazas: Plaza[];
}

interface Placed {
  pos: Vec2;
  radius: number;
}

interface Candidate {
  pos: Vec2;
  face: number; // angle the front faces
  source: 'road' | 'plaza' | 'water';
  klass: 'main' | 'street' | 'lane' | 'ring';
}

/** Is there water within `radius` world units of `p`? */
function nearWater(terrain: TerrainData, water: WaterData, p: Vec2, radius: number): boolean {
  const { size } = terrain;
  const f = worldToCellF(terrain, p.x, p.z);
  const span = Math.ceil(radius / terrain.cellSize);
  const ci = clampInt(Math.round(f.fi), 0, size - 1);
  const cj = clampInt(Math.round(f.fj), 0, size - 1);
  for (let dj = -span; dj <= span; dj++) {
    for (let di = -span; di <= span; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= size || j >= size) continue;
      if (water.mask[idx(size, i, j)]) return true;
    }
  }
  return false;
}

function inWater(terrain: TerrainData, water: WaterData, p: Vec2): boolean {
  const f = worldToCellF(terrain, p.x, p.z);
  const i = clampInt(Math.round(f.fi), 0, terrain.size - 1);
  const j = clampInt(Math.round(f.fj), 0, terrain.size - 1);
  return water.mask[idx(terrain.size, i, j)] === 1;
}

/** Gently flatten terrain under a footprint so buildings sit, not float. */
function terrace(terrain: TerrainData, p: Vec2, radius: number, target: number): void {
  const { size } = terrain;
  const f = worldToCellF(terrain, p.x, p.z);
  const span = Math.ceil(radius / terrain.cellSize) + 1;
  const ci = clampInt(Math.round(f.fi), 0, size - 1);
  const cj = clampInt(Math.round(f.fj), 0, size - 1);
  for (let dj = -span; dj <= span; dj++) {
    for (let di = -span; di <= span; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= size || j >= size) continue;
      const w = cellToWorld(terrain, i, j);
      const d = distance(w, p);
      if (d > radius) continue;
      const k = idx(size, i, j);
      const blend = 0.85 * (1 - smoothstep(radius * 0.4, radius, d));
      terrain.heights[k] = lerp(terrain.heights[k], target, blend);
    }
  }
}

export function generateSettlement(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
  center: Vec2,
  roads: RoadSegment[],
  bridges: Bridge[],
  gates: Gate[],
  enclosure: Vec2[],
  enclosureRadius: number,
  settlementRadius: number,
): SettlementResult {
  const rng = new Rng(seedValue).fork('settlement');
  const settlement = frac(params.settlementPressure);
  const prosperity = frac(params.prosperity);
  const defense = frac(params.defensePressure);
  const monumentality = frac(params.monumentality);
  const waterPresence = frac(params.waterPresence);
  const scale = frac(params.worldScale);
  const weather = new ValueNoise2D(seedValue ^ 0x4d3f17a9);

  const buildings: Building[] = [];
  const placed: Placed[] = [];
  const plazas: Plaza[] = [];

  // --- 1. The monument ----------------------------------------------------
  const firstRoadEnd = roads.length > 0 ? roads[0].points[roads[0].points.length - 1] : center;
  const approachDir = Math.atan2(firstRoadEnd.z - center.z, firstRoadEnd.x - center.x);
  const monument = makeMonument(
    rng,
    center,
    sampleHeight(terrain, center.x, center.z),
    // Face down the main approach (front toward the incoming road).
    Math.atan2(Math.cos(approachDir), Math.sin(approachDir)) + Math.PI,
    params,
  );
  terrace(terrain, monument.position, buildingPlanRadius(monument) * 1.12, monument.ground);
  buildings.push(monument);
  placed.push({
    pos: monument.position,
    radius: buildingPlanRadius(monument),
  });

  const monumentRadius = buildingPlanRadius(monument);

  // --- 2. Plazas (front, courtyard, gates, bridges, junctions) ------------
  const plazaTidiness = prosperity;
  // Civic plaza in front of the monument.
  const frontDir = monument.rotation;
  const civicR = lerp(8, 18, monumentality) * (1 - settlement * 0.3);
  const civic: Plaza = {
    center: {
      x: center.x + Math.sin(frontDir) * (monumentRadius * 0.7 + civicR),
      z: center.z + Math.cos(frontDir) * (monumentRadius * 0.7 + civicR),
    },
    radius: civicR * (0.8 + plazaTidiness * 0.4),
    kind: 'civic',
  };
  plazas.push(civic);
  placed.push({ pos: civic.center, radius: civic.radius * 0.8 });

  // Courtyard inside the walls.
  if (enclosureRadius > 18 && defense > 0.4) {
    plazas.push({
      center: { x: center.x, z: center.z },
      radius: lerp(6, 12, prosperity),
      kind: 'courtyard',
    });
  }

  // Gate forecourts.
  for (const g of gates) {
    const inward = g.rotation;
    plazas.push({
      center: {
        x: g.position.x + Math.cos(inward) * 6,
        z: g.position.z + Math.sin(inward) * 6,
      },
      radius: lerp(4, 7, prosperity),
      kind: 'gate',
    });
  }

  // Bridge-head clearings.
  for (const b of bridges) {
    plazas.push({ center: b.a, radius: lerp(3, 5.5, prosperity), kind: 'bridge' });
    plazas.push({ center: b.b, radius: lerp(3, 5.5, prosperity), kind: 'bridge' });
  }

  // A market plaza at a busy junction (denser worlds get smaller squares).
  if (settlement > 0.3 && roads.length > 3) {
    const j = roads[rng.int(1, Math.min(3, roads.length - 1))].points;
    const mp = j[Math.floor(j.length * 0.4)];
    if (distance(mp, center) < settlementRadius) {
      plazas.push({
        center: mp,
        radius: lerp(8, 4, settlement) * (0.7 + prosperity * 0.5),
        kind: 'market',
      });
      placed.push({ pos: mp, radius: 4 });
    }
  }

  // --- 3. Candidate generation -------------------------------------------
  const candidates: Candidate[] = [];

  // Along roads, set back on both sides.
  for (const road of roads) {
    const klass = road.klass === 'main' ? 'main' : road.klass === 'street' ? 'street' : 'lane';
    const stepLen = lerp(9.5, 5.5, settlement);
    let acc = 0;
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const segLen = distance(a, b);
      let t = 0;
      while (acc < segLen) {
        t = acc / segLen;
        const px = a.x + (b.x - a.x) * t;
        const pz = a.z + (b.z - a.z) * t;
        const dirx = b.x - a.x;
        const dirz = b.z - a.z;
        const len = Math.hypot(dirx, dirz) || 1;
        const nx = -dirz / len;
        const nz = dirx / len;
        const setback = road.width * 0.5 + lerp(3.2, 2.2, settlement);
        for (const side of [1, -1]) {
          const pos = { x: px + nx * setback * side, z: pz + nz * setback * side };
          // Front faces back toward the road.
          const face = Math.atan2(-nx * side, -nz * side);
          candidates.push({ pos, face, source: 'road', klass });
        }
        acc += stepLen;
      }
      acc -= segLen;
    }
  }

  // Around plazas, facing in.
  for (const plaza of plazas) {
    if (plaza.kind === 'courtyard') continue;
    const ring = plaza.radius + lerp(4, 3, settlement);
    const count = Math.max(4, Math.round((Math.PI * 2 * ring) / lerp(9, 6, settlement)));
    for (let c = 0; c < count; c++) {
      const a = (c / count) * Math.PI * 2 + rng.jitter(0.1);
      const pos = {
        x: plaza.center.x + Math.cos(a) * ring,
        z: plaza.center.z + Math.sin(a) * ring,
      };
      const face = Math.atan2(plaza.center.x - pos.x, plaza.center.z - pos.z);
      candidates.push({ pos, face, source: 'plaza', klass: 'street' });
    }
  }

  // Along the shore, facing the water (only when water matters).
  if (waterPresence > 0.4 && water.riverPath.length > 1) {
    for (let i = 0; i < water.riverPath.length - 1; i += 2) {
      const p = water.riverPath[i];
      const np = water.riverPath[i + 1];
      const dirx = np.x - p.x;
      const dirz = np.z - p.z;
      const len = Math.hypot(dirx, dirz) || 1;
      const nx = -dirz / len;
      const nz = dirx / len;
      for (const side of [1, -1]) {
        const off = lerp(7, 11, waterPresence);
        const pos = { x: p.x + nx * off * side, z: p.z + nz * off * side };
        if (distance(pos, center) > settlementRadius * 1.25) continue;
        // Face toward the water.
        const face = Math.atan2(-nx * side, -nz * side);
        candidates.push({ pos, face, source: 'water', klass: 'lane' });
      }
    }
  }

  // Deterministic shuffle so acceptance isn't biased by road order.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // --- 4. Acceptance + role assignment + construction --------------------
  const maxBuildings = Math.round(lerp(55, 260, settlement * 0.7 + scale * 0.5));
  let nextId = 1;

  for (const cand of candidates) {
    if (buildings.length >= maxBuildings) break;
    const { pos } = cand;
    const r = distance(pos, center) / settlementRadius;

    // Density falls off beyond the settlement radius.
    const inCore = pointInPolygon(pos, enclosure);
    const falloff = 1 - smoothstep(0.6, 1.4, r);
    const sourceBoost = cand.source === 'plaza' ? 1.3 : cand.source === 'water' ? 1.15 : 1;
    let prob = (0.45 + settlement * 0.6) * falloff * sourceBoost;
    if (inCore) prob += 0.22;
    if (r > 1.4) prob *= 0.35; // a few outliers beyond the edge
    if (!rng.chance(prob)) continue;

    // Reject water tiles unless this will be a waterside building.
    const onWater = inWater(terrain, water, pos);
    const isWaterside =
      cand.source === 'water' || (nearWater(terrain, water, pos, 6) && waterPresence > 0.45);
    if (onWater && !isWaterside) continue;

    // Reject steep ground.
    const slope = slopeAt(terrain, pos.x, pos.z);
    if (slope > lerp(0.9, 0.55, frac(params.terrainRuggedness))) continue;

    // Spacing against already-placed buildings.
    const role = decideRole(cand, r, inCore, isWaterside, bridges, gates, rng, params);
    const footprint = roleFootprint(role, rng, params);
    const radius = Math.max(footprint.w, footprint.d) * 0.62;
    let clash = false;
    const clashMargin = lerp(1.8, 0.5, settlement);
    for (const pl of placed) {
      if (distance(pl.pos, pos) < pl.radius + radius + clashMargin) {
        clash = true;
        break;
      }
    }
    if (clash) continue;

    const ground = isWaterside ? water.level : sampleHeight(terrain, pos.x, pos.z);
    if (!isWaterside) terrace(terrain, pos, radius * 1.1, ground);

    const refineNoise = weather.fbm(pos.x * 0.05 + 5, pos.z * 0.05 - 2, 3);
    const building = makeBuilding(
      rng,
      nextId++,
      role,
      pos,
      ground,
      cand.face + rng.jitter(0.12),
      params,
      refineNoise,
      isWaterside ? water.level : 0,
    );
    buildings.push(building);
    placed.push({ pos, radius });
  }

  void prosperity;
  return { buildings, plazas };
}

// --------------------------------------------------------------------------
// Role decision
// --------------------------------------------------------------------------
function decideRole(
  cand: Candidate,
  rNorm: number,
  inCore: boolean,
  isWaterside: boolean,
  bridges: Bridge[],
  gates: Gate[],
  rng: Rng,
  params: WorldParams,
): BuildingRole {
  const defense = frac(params.defensePressure);
  const prosperity = frac(params.prosperity);

  // Near a bridge head?
  for (const b of bridges) {
    if (distance(cand.pos, b.a) < 7 || distance(cand.pos, b.b) < 7) {
      if (rng.chance(0.6)) return 'bridgehouse';
    }
  }
  // Near a gate?
  for (const g of gates) {
    if (distance(cand.pos, g.position) < 12 && rng.chance(0.6)) return 'gatehouse';
  }
  if (isWaterside) return rng.chance(0.85) ? 'waterside' : 'tower';

  if (inCore) {
    // The guarded core: halls, occasional towers, prominent dwellings.
    if (rng.chance(0.12 + defense * 0.18)) return 'tower';
    if (rng.chance(0.18 + prosperity * 0.22)) return 'hall';
    return 'dwelling';
  }

  if (rNorm > 1.25) return rng.chance(0.5) ? 'outlier' : 'workshop';
  if (cand.source === 'road' && cand.klass === 'lane' && rng.chance(0.3)) return 'workshop';
  if (rng.chance(0.06 + defense * 0.1)) return 'tower';
  return 'dwelling';
}

// --------------------------------------------------------------------------
// Footprint sizing per role
// --------------------------------------------------------------------------
function roleFootprint(
  role: BuildingRole,
  rng: Rng,
  params: WorldParams,
): { w: number; d: number } {
  const prosperity = frac(params.prosperity);
  switch (role) {
    case 'monument':
      return {
        w: lerp(16, 30, frac(params.monumentality)),
        d: lerp(20, 40, frac(params.monumentality)),
      };
    case 'hall':
      return { w: rng.range(8, 12), d: rng.range(12, 20) };
    case 'tower':
      return { w: rng.range(4.5, 6.5), d: rng.range(4.5, 6.5) };
    case 'gatehouse':
      return { w: rng.range(6, 9), d: rng.range(6, 9) };
    case 'wallhouse':
      return { w: rng.range(5, 8), d: rng.range(6, 10) };
    case 'waterside':
      return { w: rng.range(5, 8), d: rng.range(6, 11) };
    case 'bridgehouse':
      return { w: rng.range(4.5, 7), d: rng.range(5, 9) };
    case 'workshop':
      return { w: rng.range(5, 8), d: rng.range(6, 10) };
    case 'outlier':
      return { w: rng.range(4, 6), d: rng.range(5, 8) };
    case 'dwelling':
    default:
      return { w: rng.range(4.5, 7.5) * (0.9 + prosperity * 0.3), d: rng.range(5.5, 10) };
  }
}

function buildingPlanRadius(b: Building): number {
  let radius = 0;
  for (const tier of b.tiers) {
    const offset = Math.hypot(tier.offsetX, tier.offsetZ);
    radius = Math.max(radius, offset + Math.max(tier.width, tier.depth) * 0.62);
  }
  return radius;
}

// --------------------------------------------------------------------------
// The monument
// --------------------------------------------------------------------------
function makeMonument(
  rng: Rng,
  pos: Vec2,
  ground: number,
  rotation: number,
  params: WorldParams,
): Building {
  const monumentality = frac(params.monumentality);
  const defense = frac(params.defensePressure);
  const prosperity = frac(params.prosperity);
  const water = frac(params.waterPresence);

  const fp = roleFootprint('monument', rng, params);

  // Character: fortress (high defense), cathedral/palace (high prosperity, low
  // defense), waterside hall (water), or grand hall otherwise. All one rule.
  const fortressScore = defense * 1.2 + monumentality * 0.4;
  const sacralScore = prosperity * 1.1 + monumentality * 0.5 - defense * 0.6;
  const waterScore = water * 0.9 - defense * 0.3;

  let roof: RoofKind;
  let turrets: number;
  let storeys: number;
  let wallMaterial: WallMaterial;
  let height: number;
  if (fortressScore >= sacralScore && fortressScore >= waterScore) {
    // Citadel / keep.
    roof = rng.chance(0.5) ? 'pyramid' : 'hip';
    turrets = rng.int(2, 4);
    storeys = Math.round(lerp(3, 5, monumentality));
    wallMaterial = 'stone';
    height = lerp(16, 30, monumentality);
  } else if (sacralScore >= waterScore) {
    // Cathedral / palace.
    roof = rng.chance(0.6) ? 'spire' : 'gable';
    turrets = rng.chance(0.6) ? 2 : 0;
    storeys = Math.round(lerp(3, 4, monumentality));
    wallMaterial = prosperity > 0.6 ? 'stone' : 'plaster';
    height = lerp(18, 32, monumentality);
  } else {
    // Waterside great hall.
    roof = 'gable';
    turrets = rng.chance(0.5) ? 1 : 0;
    storeys = 3;
    wallMaterial = prosperity > 0.5 ? 'stone' : 'halfTimber';
    height = lerp(14, 24, monumentality);
  }

  const broadBase = {
    width: fp.w * 0.72,
    depth: fp.d * 0.78,
    height: height * 0.86,
    baseOffset: 0,
    offsetX: 0,
    offsetZ: 0,
  };
  const highCore = {
    width: fp.w * 0.44,
    depth: fp.d * 0.48,
    height: height * lerp(1.18, 1.5, monumentality),
    baseOffset: 0,
    offsetX: 0,
    offsetZ: -fp.d * 0.06,
  };
  const frontPorch = {
    width: fp.w * lerp(0.32, 0.42, prosperity),
    depth: fp.d * 0.22,
    height: height * lerp(0.42, 0.58, defense),
    baseOffset: 0,
    offsetX: 0,
    offsetZ: fp.d * 0.48,
  };
  const sideSign = rng.chance(0.5) ? 1 : -1;
  const sideWing = {
    width: fp.w * lerp(0.34, 0.46, prosperity),
    depth: fp.d * lerp(0.36, 0.52, monumentality),
    height: height * lerp(0.52, 0.7, prosperity),
    baseOffset: 0,
    offsetX: sideSign * fp.w * 0.5,
    offsetZ: rng.jitter(fp.d * 0.12),
  };
  const counterWing = {
    width: fp.w * lerp(0.24, 0.34, monumentality),
    depth: fp.d * lerp(0.28, 0.4, water),
    height: height * lerp(0.42, 0.58, prosperity),
    baseOffset: 0,
    offsetX: -sideSign * fp.w * 0.46,
    offsetZ: fp.d * lerp(-0.2, 0.18, water),
  };
  const tiers = [broadBase, highCore, frontPorch, sideWing, counterWing];

  return {
    id: 0,
    role: 'monument',
    position: pos,
    ground,
    rotation,
    tiers,
    roof,
    roofHeight: height * lerp(0.5, 0.9, monumentality),
    overhang: 0.8,
    wallMaterial,
    refinement: Math.min(1, prosperity * 0.7 + monumentality * 0.4),
    turrets,
    hasChimney: false,
    stiltHeight: 0,
    storeys,
  };
}

// --------------------------------------------------------------------------
// Generic building construction
// --------------------------------------------------------------------------
function makeBuilding(
  rng: Rng,
  id: number,
  role: BuildingRole,
  pos: Vec2,
  ground: number,
  rotation: number,
  params: WorldParams,
  refineNoise: number,
  waterLevel: number,
): Building {
  const prosperity = frac(params.prosperity);
  const defense = frac(params.defensePressure);
  const fp = roleFootprint(role, rng, params);

  const refinement = clamp01(prosperity * 0.75 + refineNoise * 0.4 - 0.1);

  // Material trends with prosperity and role.
  let wallMaterial: WallMaterial;
  if (role === 'tower' || role === 'gatehouse' || role === 'wallhouse') {
    wallMaterial = 'stone';
  } else if (role === 'waterside' || role === 'bridgehouse') {
    wallMaterial = rng.chance(0.6) ? 'timber' : 'halfTimber';
  } else if (prosperity > 0.7) {
    wallMaterial = rng.chance(0.6) ? 'stone' : 'halfTimber';
  } else if (prosperity > 0.4) {
    wallMaterial = rng.chance(0.5) ? 'halfTimber' : 'plaster';
  } else {
    wallMaterial = rng.chance(0.5) ? 'timber' : 'plaster';
  }

  // Storeys & height.
  let storeys: number;
  const storeyHeight = lerp(2.6, 3.4, prosperity);
  if (role === 'tower') storeys = rng.int(3, 5);
  else if (role === 'hall') storeys = rng.int(2, 3);
  else if (role === 'gatehouse') storeys = rng.int(2, 3);
  else storeys = rng.int(1, prosperity > 0.5 ? 3 : 2);
  if (role === 'outlier') storeys = 1;
  const bodyHeight = storeys * storeyHeight;

  // Roof selection.
  let roof: RoofKind;
  if (role === 'tower') roof = rng.chance(0.6) ? 'pyramid' : 'spire';
  else if (role === 'workshop' || role === 'outlier') roof = rng.chance(0.4) ? 'shed' : 'gable';
  else if (prosperity > 0.55) roof = rng.chance(0.7) ? 'gable' : 'hip';
  else roof = 'gable';
  const steepness = lerp(0.7, 1.35, prosperity) * (role === 'tower' ? 1.4 : 1);
  const roofHeight =
    role === 'tower' ? fp.w * 0.9 * steepness : Math.min(fp.w, fp.d) * 0.55 * steepness;

  // Massing: main block, plus an optional lower wing for halls/larger houses.
  const tiers = [
    { width: fp.w, depth: fp.d, height: bodyHeight, baseOffset: 0, offsetX: 0, offsetZ: 0 },
  ];
  if ((role === 'hall' || (role === 'dwelling' && rng.chance(0.3))) && fp.d > 8) {
    const wingW = fp.w * rng.range(0.5, 0.8);
    const wingD = fp.d * rng.range(0.35, 0.5);
    tiers.push({
      width: wingW,
      depth: wingD,
      height: bodyHeight * rng.range(0.6, 0.85),
      baseOffset: 0,
      offsetX: (fp.w * 0.5 + wingW * 0.4) * (rng.chance(0.5) ? 1 : -1),
      offsetZ: rng.jitter(fp.d * 0.15),
    });
    roof = 'gable';
  }

  const turrets =
    role === 'tower' ? 0 : role === 'hall' && defense > 0.5 && rng.chance(0.5) ? 2 : 0;
  const hasChimney = role !== 'tower' && role !== 'outlier' && rng.chance(0.4 + prosperity * 0.4);
  const stiltHeight = waterLevel > 0 ? Math.max(1.5, waterLevel - ground + 1.5) : 0;

  return {
    id,
    role,
    position: pos,
    ground: waterLevel > 0 ? waterLevel : ground,
    rotation,
    tiers,
    roof,
    roofHeight,
    overhang: lerp(0.25, 0.7, prosperity),
    wallMaterial,
    refinement,
    turrets,
    hasChimney,
    stiltHeight,
    storeys,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
