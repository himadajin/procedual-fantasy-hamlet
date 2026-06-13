import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../../generation/params';
import type { TerrainData, World, WorldSummary } from '../../generation/types';
import { buildRoadGeometry } from './landscape';

function flatTerrain(): TerrainData {
  return {
    size: 2,
    half: 24,
    heights: new Float32Array(4),
    cellSize: 48,
    minHeight: 0,
    maxHeight: 0,
  };
}

function summary(params: WorldParams): WorldSummary {
  return {
    seed: 'test',
    seedValue: 1,
    params,
    buildingCount: 0,
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

function roadWorld(params: WorldParams): World {
  const terrain = flatTerrain();
  return {
    seed: 'test',
    seedValue: 1,
    params,
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
    roads: [
      {
        points: [
          { x: -10, z: -4 },
          { x: 0, z: 0 },
          { x: 10, z: 4 },
        ],
        width: 3.2,
        klass: 'main',
      },
    ],
    plazas: [{ center: { x: 0, z: 0 }, radius: 4, kind: 'civic' }],
    accesses: [
      {
        buildingId: 1,
        start: { x: -2, z: 5 },
        end: { x: 0, z: 1.5 },
        width: 1.2,
        kind: 'road',
        material: 'cobble',
      },
    ],
    buildings: [],
    walls: [],
    towers: [],
    gates: [],
    bridges: [],
    plants: [],
    summary: summary(params),
  };
}

function triangleCount(world: World): number {
  const geometry = buildRoadGeometry(world);
  expect(geometry).not.toBeNull();
  return geometry!.index!.count / 3;
}

describe('landscape road meshing', () => {
  it('adds structural road edges, plaza rings and access aprons instead of flat ribbons only', () => {
    const count = triangleCount(roadWorld(DEFAULT_PARAMS));

    expect(count).toBeGreaterThan(120);
  });

  it('uses prosperity to increase paved road detail', () => {
    const poor = roadWorld({ ...DEFAULT_PARAMS, prosperity: 20 });
    const prosperous = roadWorld({ ...DEFAULT_PARAMS, prosperity: 85 });

    expect(triangleCount(prosperous)).toBeGreaterThan(triangleCount(poor));
  });
});
