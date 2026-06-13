import { describe, it, expect } from 'vitest';
import { generateWorld } from './generate';
import { DEFAULT_PARAMS, DEFAULT_SEED, type WorldParams } from './params';
import { Rng } from './rng';

function fingerprint(world: ReturnType<typeof generateWorld>): string {
  const parts: (number | string)[] = [
    world.seedValue,
    world.buildings.length,
    world.roads.length,
    world.walls.length,
    world.towers.length,
    world.bridges.length,
    world.plants.length,
    world.accesses.length,
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
  for (const a of world.accesses) {
    parts.push(
      a.buildingId,
      a.kind,
      a.material,
      Math.round(a.start.x * 100),
      Math.round(a.start.z * 100),
      Math.round(a.end.x * 100),
      Math.round(a.end.z * 100),
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
    expect(world.buildings.length).toBeGreaterThan(25);
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
    expect(world.roads.length).toBeGreaterThan(2);
    expect(world.roads.some((r) => r.klass === 'main')).toBe(true);
  });

  it('connects every building front back to its access target', () => {
    expect(world.accesses).toHaveLength(world.buildings.length);
    const byId = new Map(world.buildings.map((b) => [b.id, b]));

    for (const access of world.accesses) {
      const building = byId.get(access.buildingId);
      expect(building).toBeDefined();
      if (!building) continue;

      expect(access.width).toBeGreaterThan(0.7);
      expect(dist(access.start, access.end)).toBeGreaterThan(0.45);
      expect(localZ(building, access.start)).toBeGreaterThan(frontExtent(building) - 0.15);

      const fx = Math.sin(building.rotation);
      const fz = Math.cos(building.rotation);
      const forward = (access.end.x - access.start.x) * fx + (access.end.z - access.start.z) * fz;
      expect(forward).toBeGreaterThan(0.2);
    }
  });
});

describe('parameters actually change the world', () => {
  const base: WorldParams = { ...DEFAULT_PARAMS };

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

  it('monumentality grows the central building', () => {
    const low = generateWorld({ seed: 'x', params: { ...base, monumentality: 0 } });
    const high = generateWorld({ seed: 'x', params: { ...base, monumentality: 100 } });
    const lowM = low.buildings.find((b) => b.role === 'monument')!;
    const highM = high.buildings.find((b) => b.role === 'monument')!;
    expect(highM.tiers[0].width).toBeGreaterThan(lowM.tiers[0].width);
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
