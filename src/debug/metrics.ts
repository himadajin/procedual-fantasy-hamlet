import type { BuildingRole, PlantKind, RoadEdge, WaterBodyKind, World } from '../generation/types';

export interface DebugWorldMetrics {
  terrain: {
    minHeight: number;
    maxHeight: number;
    heightRange: number;
  };
  water: {
    coverage: number;
    kinds: Partial<Record<WaterBodyKind, number>>;
    hasMoat: boolean;
    riverPointCount: number;
  };
  roads: {
    nodeCount: number;
    edgeCount: number;
    plazaCount: number;
    bridgeEdgeCount: number;
    clearanceCount: number;
    settlementRadius: number;
  };
  structures: {
    buildingCount: number;
    byRole: Partial<Record<BuildingRole, number>>;
    wallSegmentCount: number;
    towerCount: number;
    gateCount: number;
    bridgeCount: number;
  };
  vegetation: {
    plantCount: number;
    byKind: Partial<Record<PlantKind, number>>;
  };
}

function countBy<T extends string>(items: readonly T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

function isBridgeEdge(edge: RoadEdge): boolean {
  return edge.waterCrossing !== null;
}

export function buildWorldMetrics(world: World): DebugWorldMetrics {
  const minHeight = world.terrain.minHeight;
  const maxHeight = world.terrain.maxHeight;

  return {
    terrain: {
      minHeight,
      maxHeight,
      heightRange: maxHeight - minHeight,
    },
    water: {
      coverage: world.water.coverage,
      kinds: countBy(world.water.kinds),
      hasMoat: world.water.hasMoat,
      riverPointCount: world.water.riverPath.length,
    },
    roads: {
      nodeCount: world.roadGraph.nodes.length,
      edgeCount: world.roadGraph.edges.length,
      plazaCount: world.roadGraph.plazas.length,
      bridgeEdgeCount: world.roadGraph.edges.filter(isBridgeEdge).length,
      clearanceCount: world.roadGraph.clearances.length,
      settlementRadius: world.roadGraph.settlementRadius,
    },
    structures: {
      buildingCount: world.buildings.length,
      byRole: countBy(world.buildings.map((building) => building.role)),
      wallSegmentCount: world.walls.length,
      towerCount: world.towers.length,
      gateCount: world.gates.length,
      bridgeCount: world.roadGraph.bridges.length,
    },
    vegetation: {
      plantCount: world.plants.length,
      byKind: countBy(world.plants.map((plant) => plant.kind)),
    },
  };
}
