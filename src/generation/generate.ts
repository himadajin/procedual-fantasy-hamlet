/**
 * Generation orchestrator. Runs the phases in dependency order — terrain →
 * water → center → roads → defenses → settlement → vegetation — and assembles
 * the read-only summary. The whole thing is a pure function of (seed, params):
 * call it twice with the same inputs and you get an identical World.
 */
import { normalizeSeed } from './rng';
import { clampParams, type WorldParams } from './params';
import { generateTerrain } from './terrain';
import { generateWater } from './water';
import { pickCenter } from './center';
import { generateRoads } from './roads';
import { generateDefenses } from './defenses';
import { generateSettlement } from './settlement';
import { generateVegetation } from './vegetation';
import type { Building, World, WorldSummary } from './types';

export interface GenerateInput {
  seed: string;
  params: WorldParams;
}

export function generateWorld(input: GenerateInput): World {
  const params = clampParams(input.params);
  const seed = input.seed.trim() || 'aldermarch';
  const seedValue = normalizeSeed(seed);

  const terrain = generateTerrain(seedValue, params);
  const water = generateWater(seedValue, params, terrain);
  const { center } = pickCenter(seedValue, params, terrain, water);
  const primaryRoadGraph = generateRoads(seedValue, params, terrain, water, center);
  const defenses = generateDefenses(
    seedValue,
    params,
    terrain,
    water,
    center,
    primaryRoadGraph.settlementRadius,
    primaryRoadGraph.gateAnchors,
  );
  const settlement = generateSettlement(
    seedValue,
    params,
    terrain,
    water,
    center,
    primaryRoadGraph,
    defenses.gates,
    defenses.enclosure,
    defenses.enclosureRadius,
  );
  const roadGraph = settlement.roadGraph;
  const plants = generateVegetation(
    seedValue,
    params,
    terrain,
    water,
    settlement.buildings,
    roadGraph,
    center,
    defenses.enclosureRadius,
    roadGraph.settlementRadius,
  );

  const summary = buildSummary({
    seed,
    seedValue,
    params,
    buildings: settlement.buildings,
    towers: defenses.towers.length,
    bridges: roadGraph.bridges.length,
    accesses: roadGraph.edges.filter((edge) => edge.kind === 'access').length,
    plants: plants.length,
    hasWalls: defenses.hasWalls,
    hasMoat: defenses.hasMoat,
    gates: defenses.gates.length,
    water,
    half: terrain.half,
    terrainVerts: terrain.size * terrain.size,
  });

  return {
    seed,
    seedValue,
    params,
    half: terrain.half,
    terrain,
    water,
    center,
    roadGraph,
    buildings: settlement.buildings,
    walls: defenses.walls,
    towers: defenses.towers,
    gates: defenses.gates,
    plants,
    summary,
  };
}

function describeMonument(m: Building | undefined): string {
  if (!m) return 'A modest central hall.';
  const mat =
    m.wallMaterial === 'stone'
      ? 'stone'
      : m.wallMaterial === 'halfTimber'
        ? 'half-timbered'
        : m.wallMaterial === 'plaster'
          ? 'plastered'
          : 'timber';
  let type: string;
  if (m.turrets >= 2 && m.wallMaterial === 'stone' && (m.roof === 'pyramid' || m.roof === 'hip')) {
    type = 'fortified citadel keep';
  } else if (m.roof === 'spire') {
    type = 'cathedral-like great church';
  } else if (m.turrets >= 1) {
    type = 'turreted great hall';
  } else {
    type = 'grand hall';
  }
  const turretText = m.turrets > 0 ? `, ${m.turrets} turret${m.turrets > 1 ? 's' : ''}` : '';
  return `A ${mat} ${type}${turretText}, ~${Math.round(m.tiers[1]?.height ?? m.tiers[0].height)}m tall.`;
}

interface SummaryInput {
  seed: string;
  seedValue: number;
  params: WorldParams;
  buildings: Building[];
  towers: number;
  bridges: number;
  accesses: number;
  plants: number;
  hasWalls: boolean;
  hasMoat: boolean;
  gates: number;
  water: World['water'];
  half: number;
  terrainVerts: number;
}

function buildSummary(s: SummaryInput): WorldSummary {
  const monument = s.buildings.find((b) => b.role === 'monument');

  // Water description.
  const waterParts: string[] = [];
  if (s.water.kinds.includes('river')) waterParts.push('a meandering river');
  if (s.water.kinds.includes('lake')) waterParts.push('a lake');
  if (s.water.kinds.includes('pond')) waterParts.push('ponds');
  if (s.water.hasMoat) waterParts.push('a defensive moat');
  const cover = Math.round(s.water.coverage * 100);
  const waterText =
    waterParts.length > 0
      ? `${capitalize(joinList(waterParts))} (${cover}% water cover), with ${s.bridges} bridge${s.bridges === 1 ? '' : 's'}.`
      : `Dry basin, little open water (${cover}%).`;

  // Defenses description.
  let defenseText: string;
  if (s.hasWalls) {
    defenseText = `Ring wall with ${s.towers} tower${s.towers === 1 ? '' : 's'}, ${s.gates} gate${s.gates === 1 ? '' : 's'}${s.hasMoat ? ' and a moat' : ''}.`;
  } else if (s.towers > 0) {
    defenseText = `Light defenses: low revetments and ${s.towers} watchtower${s.towers === 1 ? '' : 's'}.`;
  } else {
    defenseText = 'Open settlement, no significant fortification.';
  }

  // Scale.
  const n = s.buildings.length;
  const scaleWord = n < 35 ? 'Hamlet' : n < 80 ? 'Village' : n < 140 ? 'Town' : 'Walled town';
  const scaleText = `${scaleWord}, ~${Math.round(s.half * 2)}m across, ${n} structures.`;

  // Triangle estimate (very rough) for the load indicator.
  const triPerBuilding = 90;
  const triEstimate =
    s.terrainVerts * 2 +
    n * triPerBuilding +
    s.towers * 80 +
    s.bridges * 40 +
    s.accesses * 16 +
    s.plants * 60 +
    4000;
  const complexity =
    triEstimate < 90_000
      ? 'Light'
      : triEstimate < 180_000
        ? 'Moderate'
        : triEstimate < 320_000
          ? 'Heavy'
          : 'Very heavy';

  return {
    seed: s.seed,
    seedValue: s.seedValue,
    params: s.params,
    buildingCount: n,
    monument: describeMonument(monument),
    water: waterText,
    defenses: defenseText,
    scale: scaleText,
    complexity: `${complexity} (~${Math.round(triEstimate / 1000)}k triangles)`,
    triangleEstimate: triEstimate,
    vegetationCount: s.plants,
    bridgeCount: s.bridges,
    towerCount: s.towers,
    hasWalls: s.hasWalls,
    hasMoat: s.hasMoat,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
