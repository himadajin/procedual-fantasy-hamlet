import { generateWorld } from '../generation/generate';
import { DEFAULT_PARAMS, DEFAULT_SEED } from '../generation/params';
import { buildWorldMetrics } from './metrics';

describe('debug world metrics', () => {
  it('summarizes generated world structure without exposing full object lists', () => {
    const world = generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS });
    const metrics = buildWorldMetrics(world);

    expect(metrics.terrain.minHeight).toBe(world.terrain.minHeight);
    expect(metrics.terrain.maxHeight).toBe(world.terrain.maxHeight);
    expect(metrics.terrain.heightRange).toBeCloseTo(
      world.terrain.maxHeight - world.terrain.minHeight,
    );
    expect(metrics.water.coverage).toBe(world.water.coverage);
    expect(metrics.water.hasMoat).toBe(world.water.hasMoat);
    expect(metrics.water.riverPointCount).toBe(world.water.riverPath.length);
    expect(metrics.roads.nodeCount).toBe(world.roadGraph.nodes.length);
    expect(metrics.roads.edgeCount).toBe(world.roadGraph.edges.length);
    expect(metrics.roads.bridgeEdgeCount).toBe(
      world.roadGraph.edges.filter((edge) => edge.waterCrossing !== null).length,
    );
    expect(metrics.structures.buildingCount).toBe(world.buildings.length);
    expect(metrics.structures.buildingCount).toBe(world.summary.buildingCount);
    expect(metrics.structures.bridgeCount).toBe(world.summary.bridgeCount);
    expect(metrics.vegetation.plantCount).toBe(world.summary.vegetationCount);
  });
});
