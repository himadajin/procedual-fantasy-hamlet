import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../../generation/params';
import type { Building, TerrainData, World, WorldSummary } from '../../generation/types';
import { buildStructures } from './structures';

function flatTerrain(): TerrainData {
  return {
    size: 2,
    half: 16,
    heights: new Float32Array(4),
    cellSize: 32,
    minHeight: 0,
    maxHeight: 0,
  };
}

function summary(): WorldSummary {
  return {
    seed: 'test',
    seedValue: 1,
    params: DEFAULT_PARAMS,
    buildingCount: 1,
    monument: 'test',
    water: 'none',
    defenses: 'none',
    scale: 'test',
    complexity: 'test',
    triangleEstimate: 0,
    vegetationCount: 0,
    bridgeCount: 0,
    towerCount: 0,
    hasWalls: false,
    hasMoat: false,
  };
}

function roofYawBuilding(): Building {
  return {
    id: 1,
    role: 'dwelling',
    position: { x: 0, z: 0 },
    ground: 0,
    rotation: 0,
    tiers: [
      {
        width: 10,
        depth: 4,
        height: 5,
        baseOffset: 0,
        offsetX: 0,
        offsetZ: 0,
        roof: 'gable',
        roofYaw: Math.PI / 2,
      },
    ],
    roof: 'gable',
    roofHeight: 2,
    overhang: 0.5,
    wallMaterial: 'plaster',
    refinement: 0.7,
    turrets: 0,
    hasChimney: false,
    stiltHeight: 0,
    storeys: 2,
  };
}

function worldWith(building: Building): World {
  const terrain = flatTerrain();
  return {
    seed: 'test',
    seedValue: 1,
    params: DEFAULT_PARAMS,
    half: terrain.half,
    terrain,
    water: {
      level: -10,
      mask: new Uint8Array(4),
      coverage: 0,
      kinds: [],
      hasMoat: false,
      riverPath: [],
    },
    center: { x: 0, z: 0 },
    roads: [],
    plazas: [],
    accesses: [],
    buildings: [building],
    walls: [],
    towers: [],
    gates: [],
    bridges: [],
    plants: [],
    summary: summary(),
  };
}

describe('structure meshing', () => {
  it('keeps a quarter-turned gable roof on its wall footprint', () => {
    const { geometry } = buildStructures(worldWith(roofYawBuilding()));
    const bounds = geometry.boundingBox;

    expect(bounds).not.toBeNull();
    expect(bounds!.max.x - bounds!.min.x).toBeLessThan(11.4);
    expect(bounds!.max.x - bounds!.min.x).toBeGreaterThan(10.8);
    expect(bounds!.max.z - bounds!.min.z).toBeLessThan(5.4);
  });
});
