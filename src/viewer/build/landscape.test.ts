import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../../generation/params';
import type {
  Bridge,
  Plaza,
  RoadEdge,
  RoadGraph,
  TerrainData,
  World,
  WorldSummary,
} from '../../generation/types';
import { buildRoadGeometry, buildWaterGeometry } from './landscape';

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

function shoreTerrain(): TerrainData {
  return {
    size: 4,
    half: 12,
    heights: new Float32Array([
      1,
      1,
      1,
      1, //
      1,
      -1,
      -1,
      1, //
      1,
      -1,
      -1,
      1, //
      1,
      1,
      1,
      1,
    ]),
    cellSize: 8,
    minHeight: -1,
    maxHeight: 1,
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

function roadGraph(edges: RoadEdge[], plazas: Plaza[], bridges: Bridge[] = []): RoadGraph {
  return {
    nodes: [
      { id: 'a', kind: 'center', position: { x: -10, z: -4 }, importance: 1 },
      { id: 'b', kind: 'gate', position: { x: 10, z: 4 }, importance: 0.8 },
    ],
    edges,
    plazas,
    bridges,
    clearances: edges.map((edge) => ({
      kind: edge.waterCrossing ? 'bridge' : 'road',
      points: edge.points,
      radius: edge.clearance,
    })),
    gateAnchors: [],
    settlementRadius: 16,
    junctions: [{ x: 0, z: 0 }],
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
    roadGraph: roadGraph(
      [
        {
          id: 'road',
          from: 'a',
          to: 'b',
          points: [
            { x: -10, z: -4 },
            { x: 0, z: 0 },
            { x: 10, z: 4 },
          ],
          kind: 'approach',
          width: 3.2,
          importance: 0.9,
          clearance: 3.2,
          frontage: 4.4,
          surface: 'cobble',
          waterCrossing: null,
        },
        {
          id: 'access',
          from: 'entry-a',
          to: 'entry-b',
          points: [
            { x: -2, z: 5 },
            { x: 0, z: 1.5 },
          ],
          kind: 'access',
          width: 1.2,
          importance: 0.2,
          clearance: 1.2,
          frontage: 0,
          surface: 'cobble',
          buildingId: 1,
          waterCrossing: null,
        },
      ],
      [{ center: { x: 0, z: 0 }, radius: 4, kind: 'civic' }],
    ),
    buildings: [],
    walls: [],
    towers: [],
    gates: [],
    plants: [],
    summary: summary(params),
  };
}

function waterWorld(params: WorldParams): World {
  const terrain = shoreTerrain();
  const mask = new Uint8Array([
    0,
    0,
    0,
    0, //
    0,
    1,
    1,
    0, //
    0,
    1,
    1,
    0, //
    0,
    0,
    0,
    0,
  ]);
  return {
    seed: 'test',
    seedValue: 1,
    params,
    half: terrain.half,
    terrain,
    water: {
      level: 0,
      mask,
      coverage: 0.25,
      kinds: ['pond'],
      hasMoat: false,
      riverPath: [],
    },
    center: { x: 0, z: 0 },
    roadGraph: roadGraph(
      [
        {
          id: 'bridge-road',
          from: 'a',
          to: 'b',
          points: [
            { x: -9, z: 0 },
            { x: -7, z: 0 },
            { x: 7, z: 0 },
            { x: 9, z: 0 },
          ],
          kind: 'approach',
          width: 3,
          importance: 0.75,
          clearance: 3.1,
          frontage: 4.2,
          surface: 'wood',
          waterCrossing: {
            a: { x: -7, z: 0 },
            b: { x: 7, z: 0 },
            deckLevel: 1.6,
            width: 3,
          },
        },
        {
          id: 'access',
          from: 'entry-a',
          to: 'entry-b',
          points: [
            { x: -5, z: 2 },
            { x: -1, z: 2 },
          ],
          kind: 'access',
          width: 1.25,
          importance: 0.2,
          clearance: 1.25,
          frontage: 0,
          surface: 'wood',
          buildingId: 1,
          waterCrossing: null,
        },
      ],
      [],
      [
        {
          a: { x: -7, z: 0 },
          b: { x: 7, z: 0 },
          deckLevel: 1.6,
          width: 3,
          hasHouse: false,
        },
      ],
    ),
    buildings: [],
    walls: [],
    towers: [],
    gates: [],
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

  it('adds shoreline, bridge-head and waterside access structure for water worlds', () => {
    const count = triangleCount(waterWorld(DEFAULT_PARAMS));

    expect(count).toBeGreaterThan(90);
  });
});

describe('landscape water meshing', () => {
  it('adds low-poly water accents beyond the base water surface', () => {
    const geometry = buildWaterGeometry(waterWorld({ ...DEFAULT_PARAMS, waterPresence: 85 }));

    expect(geometry).not.toBeNull();
    expect(geometry!.index!.count / 3).toBeGreaterThan(18);
  });
});
