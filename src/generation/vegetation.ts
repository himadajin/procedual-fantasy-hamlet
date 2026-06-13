/**
 * Vegetation phase. Plants are an environmental element, not clutter: edge
 * influence closes the finite diorama, grass and shrubs thin out toward the
 * built core, reeds and low shrubs line the shore, and sparse trees cling to
 * slopes. Density is suppressed inside the walls and around buildings and roads.
 */
import { ValueNoise2D } from './noise';
import { Rng } from './rng';
import { frac, type WorldParams } from './params';
import {
  distance,
  idx,
  lerp,
  sampleHeight,
  slopeAt,
  smoothstep,
  worldToCellF,
  clampInt,
} from './grid';
import { centerDistanceNorm, edgeInfluenceOnTerrain } from './fields';
import type {
  Building,
  Plant,
  PlantKind,
  RoadSegment,
  TerrainData,
  Vec2,
  WaterData,
} from './types';

function isWater(terrain: TerrainData, water: WaterData, p: Vec2): boolean {
  const f = worldToCellF(terrain, p.x, p.z);
  const i = clampInt(Math.round(f.fi), 0, terrain.size - 1);
  const j = clampInt(Math.round(f.fj), 0, terrain.size - 1);
  return water.mask[idx(terrain.size, i, j)] === 1;
}

function shoreProximity(terrain: TerrainData, water: WaterData, p: Vec2, radius: number): boolean {
  const span = Math.ceil(radius / terrain.cellSize);
  const f = worldToCellF(terrain, p.x, p.z);
  const ci = clampInt(Math.round(f.fi), 0, terrain.size - 1);
  const cj = clampInt(Math.round(f.fj), 0, terrain.size - 1);
  for (let dj = -span; dj <= span; dj++) {
    for (let di = -span; di <= span; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= terrain.size || j >= terrain.size) continue;
      if (water.mask[idx(terrain.size, i, j)]) return true;
    }
  }
  return false;
}

export function generateVegetation(
  seedValue: number,
  params: WorldParams,
  terrain: TerrainData,
  water: WaterData,
  buildings: Building[],
  roads: RoadSegment[],
  center: Vec2,
  enclosureRadius: number,
  settlementRadius: number,
): Plant[] {
  const rng = new Rng(seedValue).fork('vegetation');
  const scatter = new ValueNoise2D(seedValue ^ 0x6b1f9d37);
  const scale = frac(params.worldScale);
  const waterPresence = frac(params.waterPresence);
  const settlement = frac(params.settlementPressure);

  const plants: Plant[] = [];
  const half = terrain.half;

  // Spacing of the candidate lattice; bigger worlds get a little denser canopy.
  const spacing = lerp(8.5, 6.0, scale);
  const maxPlants = Math.round(lerp(140, 460, scale));

  // Precompute building exclusion circles.
  const exclusions: { pos: Vec2; r: number }[] = buildings.map((b) => ({
    pos: b.position,
    r: Math.max(b.tiers[0].width, b.tiers[0].depth) * 0.65 + 2,
  }));

  for (let z = -half; z <= half && plants.length < maxPlants; z += spacing) {
    for (let x = -half; x <= half && plants.length < maxPlants; x += spacing) {
      const p: Vec2 = { x: x + rng.jitter(spacing * 0.5), z: z + rng.jitter(spacing * 0.5) };
      const rNorm = centerDistanceNorm(half, p);
      if (rNorm > 1.12) continue;
      const edge = edgeInfluenceOnTerrain(terrain, p);

      const onWater = isWater(terrain, water, p);
      const shore = !onWater && shoreProximity(terrain, water, p, 2.4);

      // Density profile by meaning fields: stronger toward the environmental
      // edge, weaker in the defended/built core.
      const coreSuppression = smoothstep(enclosureRadius * 0.6, settlementRadius, rNorm * half);
      const scatterN = scatter.fbm(p.x * 0.03 + 3, p.z * 0.03 - 4, 4);
      let density = 0.12 + coreSuppression * 0.45 + edge * 0.72;
      density *= 0.4 + scatterN * 1.1; // clumping
      density *= 1 - settlement * 0.25; // tidier settlements clear more

      const slope = slopeAt(terrain, p.x, p.z);

      // Shore vegetation regardless of forest belt.
      if (shore && waterPresence > 0.3) {
        if (rng.chance(0.5 * waterPresence)) {
          plants.push(makePlant(rng, terrain, p, rng.chance(0.5) ? 'reed' : 'shrub'));
        }
        continue;
      }
      if (onWater) {
        // Occasional reeds in very shallow water margins.
        if (waterPresence > 0.5 && rng.chance(0.04)) {
          plants.push(makePlant(rng, terrain, p, 'reed', water.level));
        }
        continue;
      }

      // Sparser on steep ground (but a few cling to cliffs).
      if (slope > 0.7) density *= 0.3;

      if (!rng.chance(density)) continue;

      // Skip near buildings.
      let blocked = false;
      for (const ex of exclusions) {
        if (distance(ex.pos, p) < ex.r) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      // Skip on/near roads.
      if (nearRoad(p, roads, 2.5)) continue;

      // Pick a kind by terrain context.
      let kind: PlantKind;
      if (slope > 0.55 || rNorm > 0.8) kind = rng.chance(0.6) ? 'pine' : 'tree';
      else if (rNorm < 0.5 && rng.chance(0.5)) kind = 'shrub';
      else kind = rng.chance(0.7) ? 'tree' : 'pine';

      plants.push(makePlant(rng, terrain, p, kind));
    }
  }

  void center;
  return plants;
}

function nearRoad(p: Vec2, roads: RoadSegment[], margin: number): boolean {
  for (const road of roads) {
    const lim = road.width * 0.5 + margin;
    for (let i = 0; i < road.points.length - 1; i += 1) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1e-6;
      let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = a.x + abx * t;
      const cz = a.z + abz * t;
      if (Math.hypot(p.x - cx, p.z - cz) < lim) return true;
    }
  }
  return false;
}

function makePlant(
  rng: Rng,
  terrain: TerrainData,
  pos: Vec2,
  kind: PlantKind,
  forcedGround?: number,
): Plant {
  const ground = forcedGround ?? sampleHeight(terrain, pos.x, pos.z);
  const base = kind === 'reed' ? 0.7 : kind === 'shrub' ? 0.8 : kind === 'pine' ? 1.1 : 1.0;
  return {
    position: pos,
    ground,
    kind,
    scale: base * rng.range(0.75, 1.35),
  };
}
