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
import { distanceToRoadGraphClearance } from './roads';
import type { Building, Plant, PlantKind, RoadGraph, TerrainData, Vec2, WaterData } from './types';

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
  roadGraph: RoadGraph,
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
    r:
      b.tiers.reduce(
        (max, tier) =>
          Math.max(max, Math.hypot(tier.offsetX, tier.offsetZ) + Math.max(tier.width, tier.depth)),
        0,
      ) *
        0.62 +
      2,
  }));

  for (let z = -half; z <= half && plants.length < maxPlants; z += spacing) {
    for (let x = -half; x <= half && plants.length < maxPlants; x += spacing) {
      const p: Vec2 = { x: x + rng.jitter(spacing * 0.5), z: z + rng.jitter(spacing * 0.5) };
      const rNorm = centerDistanceNorm(half, p);
      if (rNorm > 1.12) continue;
      const edge = edgeInfluenceOnTerrain(terrain, p);
      const centerDist = rNorm * half;
      const defendedCore = enclosureRadius > 4 && centerDist < enclosureRadius * 0.95;
      const outsideDefense = enclosureRadius > 4 && centerDist > enclosureRadius * 1.05;

      const onWater = isWater(terrain, water, p);
      const shore = !onWater && shoreProximity(terrain, water, p, 2.4);
      const slope = slopeAt(terrain, p.x, p.z);
      const roadClearance = distanceToRoadGraphClearance(roadGraph, p);

      // Skip built surfaces first; later rules may place low verge plants near,
      // but not on, roads and entrance paths.
      if (roadClearance < 0.9) continue;

      let blocked = false;
      for (const ex of exclusions) {
        if (distance(ex.pos, p) < ex.r) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      // Density profile by meaning fields: stronger toward the environmental
      // edge, weaker in the defended/built core.
      const coreSuppression = smoothstep(enclosureRadius * 0.6, settlementRadius, rNorm * half);
      const scatterN = scatter.fbm(p.x * 0.03 + 3, p.z * 0.03 - 4, 4);
      let density = 0.12 + coreSuppression * 0.45 + edge * 0.72;
      density *= 0.4 + scatterN * 1.1; // clumping
      density *= 1 - settlement * 0.25; // tidier settlements clear more
      if (defendedCore) density *= 0.35;
      if (outsideDefense) density *= 1.18;

      // Shore vegetation regardless of forest belt.
      if (shore && waterPresence > 0.3) {
        const shoreChance = (defendedCore ? 0.28 : 0.58) * waterPresence;
        if (rng.chance(shoreChance)) {
          const kind = rng.chance(0.55) ? 'reed' : rng.chance(0.55) ? 'shrub' : 'grass';
          plants.push(makePlant(rng, terrain, p, kind));
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

      const roadVerge =
        roadClearance < 4.4 && centerDist < settlementRadius * 1.25 && !defendedCore;
      if (roadVerge) {
        const vergeChance = 0.18 * (1 - settlement * 0.35) * (0.6 + scatterN);
        if (rng.chance(vergeChance)) {
          plants.push(makePlant(rng, terrain, p, rng.chance(0.72) ? 'grass' : 'shrub'));
        }
        continue;
      }

      // Sparser on steep ground (but a few cling to cliffs).
      if (slope > 0.7) density *= 0.3;

      if (!rng.chance(density)) continue;

      // Pick a kind by terrain context.
      let kind: PlantKind;
      if (slope > 0.58) kind = rng.chance(0.72) ? 'pine' : 'tree';
      else if (rNorm > 0.82 || edge > 0.55) kind = rng.chance(0.62) ? 'pine' : 'tree';
      else if (outsideDefense && rng.chance(0.28)) kind = 'grass';
      else if (rNorm < 0.5 && rng.chance(0.5)) kind = 'shrub';
      else kind = rng.chance(0.55) ? 'tree' : rng.chance(0.55) ? 'grass' : 'pine';

      plants.push(makePlant(rng, terrain, p, kind));
    }
  }

  void center;
  return plants;
}

function makePlant(
  rng: Rng,
  terrain: TerrainData,
  pos: Vec2,
  kind: PlantKind,
  forcedGround?: number,
): Plant {
  const ground = forcedGround ?? sampleHeight(terrain, pos.x, pos.z);
  const base =
    kind === 'reed'
      ? 0.7
      : kind === 'grass'
        ? 0.55
        : kind === 'shrub'
          ? 0.8
          : kind === 'pine'
            ? 1.1
            : 1.0;
  return {
    position: pos,
    ground,
    kind,
    scale: base * rng.range(0.75, 1.35),
  };
}
