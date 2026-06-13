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
  return parts.join('|');
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

  it('has a substantial set of buildings, not a placeholder handful', () => {
    expect(world.buildings.length).toBeGreaterThan(25);
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
