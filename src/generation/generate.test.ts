import { describe, it, expect } from 'vitest';
import { generateWorld } from './generate';
import { DEFAULT_PARAMS, DEFAULT_SEED, type WorldParams } from './params';
import { Rng } from './rng';
import { generateTerrain } from './terrain';
import { clampInt, heightStatsInRadius, idx, worldToCellF } from './grid';
import { distanceToRoadGraphClearance } from './roads';

function fingerprint(world: ReturnType<typeof generateWorld>): string {
  const parts: (number | string)[] = [
    world.seedValue,
    world.buildings.length,
    world.roadGraph.edges.length,
    world.walls.length,
    world.towers.length,
    world.roadGraph.bridges.length,
    world.plants.length,
    world.roadGraph.edges.filter((edge) => edge.kind === 'access').length,
    Math.round(world.water.coverage * 1000),
  ];
  for (const b of world.buildings) {
    parts.push(
      b.role,
      Math.round(b.position.x * 100),
      Math.round(b.position.z * 100),
      Math.round(b.rotation * 100),
      Math.round(b.tiers[0].width * 100),
    );
  }
  for (const a of world.roadGraph.edges.filter((edge) => edge.kind === 'access')) {
    parts.push(
      a.buildingId ?? -1,
      a.kind,
      a.surface,
      Math.round(a.points[0].x * 100),
      Math.round(a.points[0].z * 100),
      Math.round(a.points[a.points.length - 1].x * 100),
      Math.round(a.points[a.points.length - 1].z * 100),
    );
  }
  for (const p of world.plants.slice(0, 24)) {
    parts.push(p.kind, Math.round(p.position.x * 100), Math.round(p.position.z * 100));
  }
  return parts.join('|');
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function frontExtent(building: ReturnType<typeof generateWorld>['buildings'][number]): number {
  return building.tiers.reduce((front, tier) => Math.max(front, tier.offsetZ + tier.depth / 2), 0);
}

function localZ(
  building: ReturnType<typeof generateWorld>['buildings'][number],
  p: { x: number; z: number },
): number {
  const dx = p.x - building.position.x;
  const dz = p.z - building.position.z;
  return dx * Math.sin(building.rotation) + dz * Math.cos(building.rotation);
}

function buildingPlanRadius(
  building: ReturnType<typeof generateWorld>['buildings'][number],
): number {
  return building.tiers.reduce(
    (radius, tier) =>
      Math.max(
        radius,
        Math.hypot(tier.offsetX, tier.offsetZ) + Math.max(tier.width, tier.depth) * 0.62,
      ),
    0,
  );
}

function averageInnerRelief(params: WorldParams): number {
  const terrain = generateTerrain(1234, params);
  let total = 0;
  let count = 0;
  const step = 12;
  for (let j = step; j < terrain.size - step; j += step) {
    for (let i = step; i < terrain.size - step; i += step) {
      const x = -terrain.half + i * terrain.cellSize;
      const z = -terrain.half + j * terrain.cellSize;
      if (Math.hypot(x, z) > terrain.half * 0.68) continue;
      total += heightStatsInRadius(terrain, { x, z }, terrain.cellSize * 3).range;
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function actualWaterCoverage(world: ReturnType<typeof generateWorld>): number {
  let wet = 0;
  for (const cell of world.water.mask) {
    if (cell) wet += 1;
  }
  return wet / world.water.mask.length;
}

function actualTerrainStats(world: ReturnType<typeof generateWorld>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const h of world.terrain.heights) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}

function isWaterAt(world: ReturnType<typeof generateWorld>, p: { x: number; z: number }): boolean {
  const f = worldToCellF(world.terrain, p.x, p.z);
  const i = clampInt(Math.round(f.fi), 0, world.terrain.size - 1);
  const j = clampInt(Math.round(f.fj), 0, world.terrain.size - 1);
  return world.water.mask[idx(world.terrain.size, i, j)] === 1;
}

describe('deterministic generation', () => {
  it('produces identical worlds for identical seed + params', () => {
    const a = generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS });
    const b = generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS });
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });

  it('produces different worlds for different seeds', () => {
    const a = generateWorld({ seed: 'alpha', params: DEFAULT_PARAMS });
    const b = generateWorld({ seed: 'beta', params: DEFAULT_PARAMS });
    expect(fingerprint(a)).not.toEqual(fingerprint(b));
  });

  it('treats numeric and string seeds consistently', () => {
    const a = generateWorld({ seed: '12345', params: DEFAULT_PARAMS });
    const b = generateWorld({ seed: '12345', params: DEFAULT_PARAMS });
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });
});

describe('default world is a believable fortified settlement', () => {
  const world = generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS });

  it('has exactly one monument as the single dominant center', () => {
    const monuments = world.buildings.filter((b) => b.role === 'monument');
    expect(monuments).toHaveLength(1);
  });

  it('builds the monument as compound massing, not a single enlarged box', () => {
    const monument = world.buildings.find((b) => b.role === 'monument')!;
    expect(monument.tiers.length).toBeGreaterThanOrEqual(5);
    expect(monument.tiers.some((t) => Math.hypot(t.offsetX, t.offsetZ) > 1)).toBe(true);
  });

  it('uses compound massing for ordinary buildings too', () => {
    const ordinary = world.buildings.filter((b) => b.role !== 'monument');
    const compound = ordinary.filter(
      (b) => b.tiers.length > 1 && b.tiers.some((t) => Math.hypot(t.offsetX, t.offsetZ) > 0.5),
    );
    expect(compound.length).toBeGreaterThan(5);
    expect(compound.length / ordinary.length).toBeGreaterThan(0.2);
  });

  it('gives compound building masses their own roof intent', () => {
    const compound = world.buildings.filter(
      (b) => b.role !== 'monument' && b.tiers.length > 1 && b.tiers.some((t) => t.roof),
    );
    expect(compound.length).toBeGreaterThan(5);
    expect(compound.some((b) => b.tiers.some((t) => Math.abs(t.roofYaw ?? 0) > 0.1))).toBe(true);
  });

  it('has a substantial set of buildings, not a placeholder handful', () => {
    expect(world.buildings.length).toBeGreaterThan(15);
  });

  it('uses vegetation to close the outer rim more than the built core', () => {
    const inner = world.plants.filter((p) => dist(p.position, world.center) < world.half * 0.32);
    const outer = world.plants.filter((p) => dist(p.position, world.center) > world.half * 0.62);

    expect(outer.length).toBeGreaterThan(inner.length);
  });

  it('produces walls, towers and water with the default (high defense/water)', () => {
    expect(world.summary.hasWalls).toBe(true);
    expect(world.towers.length).toBeGreaterThan(0);
    expect(world.water.coverage).toBeGreaterThan(0.02);
  });

  it('builds a road skeleton', () => {
    expect(world.roadGraph.edges.length).toBeGreaterThan(2);
    expect(world.roadGraph.nodes.some((node) => node.kind === 'center')).toBe(true);
    expect(world.roadGraph.edges.some((edge) => edge.kind === 'approach')).toBe(true);
  });

  it('connects every building front back to its access target', () => {
    const accessEdges = world.roadGraph.edges.filter((edge) => edge.kind === 'access');
    expect(accessEdges).toHaveLength(world.buildings.length);
    const byId = new Map(world.buildings.map((b) => [b.id, b]));

    for (const access of accessEdges) {
      const building = byId.get(access.buildingId ?? -1);
      expect(building).toBeDefined();
      if (!building) continue;
      const start = access.points[0];
      const end = access.points[access.points.length - 1];

      expect(access.clearance).toBeGreaterThan(0.7);
      expect(dist(start, end)).toBeGreaterThan(0.45);
      expect(localZ(building, start)).toBeGreaterThan(frontExtent(building) - 0.15);

      const fx = Math.sin(building.rotation);
      const fz = Math.cos(building.rotation);
      const forward = (end.x - start.x) * fx + (end.z - start.z) * fz;
      expect(forward).toBeGreaterThan(0.2);
    }
  });

  it('keeps the road graph internally connected and typed', () => {
    const nodeIds = new Set(world.roadGraph.nodes.map((node) => node.id));
    for (const edge of world.roadGraph.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(edge.importance).toBeGreaterThanOrEqual(0);
      expect(edge.importance).toBeLessThanOrEqual(1);
      expect(edge.clearance).toBeGreaterThan(0.4);
      expect(edge.frontage).toBeGreaterThanOrEqual(0);
    }
  });

  it('creates bridges only from water-crossing road edges', () => {
    const crossings = world.roadGraph.edges.filter((edge) => edge.waterCrossing);
    expect(world.roadGraph.bridges.length).toBe(crossings.length);
    for (const crossing of crossings) {
      const waterCrossing = crossing.waterCrossing!;
      expect(crossing.points.some((p) => dist(p, waterCrossing.a) < 0.1)).toBe(true);
      expect(crossing.points.some((p) => dist(p, waterCrossing.b) < 0.1)).toBe(true);
    }
  });

  it('keeps building centers outside primary road, bridge and plaza clearance', () => {
    for (const building of world.buildings) {
      if (building.role === 'monument') continue;
      expect(distanceToRoadGraphClearance(world.roadGraph, building.position)).toBeGreaterThan(0);
    }
  });
});

describe('parameters actually change the world', () => {
  const base: WorldParams = { ...DEFAULT_PARAMS };

  it('uses terrain ruggedness 50 as the ordinary default baseline', () => {
    expect(DEFAULT_PARAMS.terrainRuggedness).toBe(50);
  });

  it('settlement pressure increases building count', () => {
    const low = generateWorld({ seed: 'x', params: { ...base, settlementPressure: 5 } });
    const high = generateWorld({ seed: 'x', params: { ...base, settlementPressure: 100 } });
    expect(high.buildings.length).toBeGreaterThan(low.buildings.length);
  });

  it('defense pressure controls walls', () => {
    const low = generateWorld({ seed: 'x', params: { ...base, defensePressure: 0 } });
    const high = generateWorld({ seed: 'x', params: { ...base, defensePressure: 100 } });
    expect(high.walls.length).toBeGreaterThanOrEqual(low.walls.length);
    expect(high.summary.hasWalls).toBe(true);
  });

  it('water presence controls water coverage', () => {
    const dry = generateWorld({ seed: 'x', params: { ...base, waterPresence: 0 } });
    const wet = generateWorld({ seed: 'x', params: { ...base, waterPresence: 100 } });
    expect(wet.water.coverage).toBeGreaterThan(dry.water.coverage);
  });

  it('does not make moats the default result for ordinary fortified wet worlds', () => {
    const ordinary = generateWorld({
      seed: 'riverhold',
      params: { ...base, defensePressure: 70, waterPresence: 70 },
    });

    expect(ordinary.summary.hasWalls).toBe(true);
    expect(ordinary.summary.hasMoat).toBe(false);
  });

  it('creates advanced moats only when strong defense, water and terrain align', () => {
    const moated = generateWorld({
      seed: 'riverhold',
      params: {
        ...base,
        worldScale: 82,
        defensePressure: 90,
        waterPresence: 85,
        terrainRuggedness: 45,
      },
    });

    expect(moated.summary.hasMoat).toBe(true);
    expect(moated.water.hasMoat).toBe(true);
    expect(moated.water.kinds).toContain('moat');
    expect(moated.water.coverage).toBeCloseTo(actualWaterCoverage(moated), 5);

    const stats = actualTerrainStats(moated);
    expect(moated.terrain.minHeight).toBeCloseTo(stats.min, 5);
    expect(moated.terrain.maxHeight).toBeCloseTo(stats.max, 5);
  });

  it('keeps gate causeways readable when a moat is present', () => {
    const world = generateWorld({
      seed: 'riverhold',
      params: {
        ...base,
        worldScale: 82,
        defensePressure: 90,
        waterPresence: 85,
        terrainRuggedness: 45,
      },
    });

    expect(world.summary.hasMoat).toBe(true);
    for (const gate of world.gates) {
      const outward = Math.atan2(
        gate.position.z - world.center.z,
        gate.position.x - world.center.x,
      );
      let wetSamples = 0;
      let samples = 0;
      for (let offset = 3; offset <= 18; offset += 3) {
        const p = {
          x: gate.position.x + Math.cos(outward) * offset,
          z: gate.position.z + Math.sin(outward) * offset,
        };
        if (isWaterAt(world, p)) wetSamples += 1;
        samples += 1;
      }

      expect(wetSamples).toBeLessThan(samples / 2);
    }
  });

  it('water and open space produce shore plants and low grass', () => {
    const wet = generateWorld({
      seed: 'reedford',
      params: {
        ...base,
        worldScale: 52,
        waterPresence: 86,
        terrainRuggedness: 62,
        prosperity: 45,
      },
    });

    expect(wet.plants.some((p) => p.kind === 'reed')).toBe(true);
    expect(wet.plants.some((p) => p.kind === 'grass')).toBe(true);
  });

  it('world scale grows the physical extent', () => {
    const small = generateWorld({ seed: 'x', params: { ...base, worldScale: 0 } });
    const large = generateWorld({ seed: 'x', params: { ...base, worldScale: 100 } });
    expect(large.half).toBeGreaterThan(small.half);
  });

  it('terrain ruggedness changes landform relief around the 50 baseline', () => {
    const calm = averageInnerRelief({ ...base, terrainRuggedness: 0 });
    const ordinary = averageInnerRelief({ ...base, terrainRuggedness: 50 });
    const rugged = averageInnerRelief({ ...base, terrainRuggedness: 100 });

    expect(calm).toBeLessThan(ordinary);
    expect(rugged).toBeGreaterThan(ordinary);
  });

  it('monumentality grows the central building', () => {
    const low = generateWorld({ seed: 'x', params: { ...base, monumentality: 0 } });
    const high = generateWorld({ seed: 'x', params: { ...base, monumentality: 100 } });
    const lowM = low.buildings.find((b) => b.role === 'monument')!;
    const highM = high.buildings.find((b) => b.role === 'monument')!;
    expect(highM.tiers[0].width).toBeGreaterThan(lowM.tiers[0].width);
  });
});

describe('terrain-first building fit', () => {
  it('uses foundations rather than terrain terracing to absorb accepted footprint relief', () => {
    const world = generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS });

    for (const building of world.buildings) {
      if (building.stiltHeight > 0) continue;
      const radius = buildingPlanRadius(building) * 0.9;
      const relief = heightStatsInRadius(world.terrain, building.position, radius).range;

      expect(building.foundationDepth).toBeGreaterThanOrEqual(relief - 0.05);
    }
  });
});

describe('rng determinism', () => {
  it('mulberry32 stream is stable for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('forked streams diverge from the parent', () => {
    const parent = new Rng(7);
    const child = parent.fork('roads');
    expect(child.next()).not.toEqual(new Rng(7).next());
  });
});
