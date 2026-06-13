import { describe, expect, it } from 'vitest';
import { generateWorld } from '../../generation/generate';
import { DEFAULT_PARAMS, DEFAULT_SEED } from '../../generation/params';
import type { Building } from '../../generation/types';
import { isFacadeSpanExposed, tierFacadeExposures } from './facadeVisibility';

function compoundBuilding(): Building {
  return {
    id: 1,
    role: 'hall',
    position: { x: 0, z: 0 },
    ground: 0,
    rotation: 0,
    roof: 'gable',
    roofHeight: 2,
    overhang: 0.4,
    wallMaterial: 'plaster',
    refinement: 0.7,
    turrets: 0,
    hasChimney: false,
    stiltHeight: 0,
    storeys: 2,
    tiers: [
      {
        width: 10,
        depth: 8,
        height: 5,
        baseOffset: 0,
        offsetX: 0,
        offsetZ: 0,
      },
      {
        width: 4,
        depth: 3,
        height: 3,
        baseOffset: 0,
        offsetX: 0,
        offsetZ: 5,
      },
    ],
  };
}

describe('tier facade visibility', () => {
  it('blocks only the span covered by an attached mass', () => {
    const exposures = tierFacadeExposures(compoundBuilding(), 0);
    const front = exposures[0];

    expect(isFacadeSpanExposed(front, 0, 0.9, 0.35)).toBe(false);
    expect(isFacadeSpanExposed(front, -4, 0.55)).toBe(true);
    expect(isFacadeSpanExposed(front, 4, 0.55)).toBe(true);
  });

  it('hides the buried back face of the attached mass but keeps its front usable', () => {
    const exposures = tierFacadeExposures(compoundBuilding(), 1);

    expect(isFacadeSpanExposed(exposures[1], 0, 0.9, 0.35)).toBe(false);
    expect(isFacadeSpanExposed(exposures[0], 0, 0.9, 0.35)).toBe(true);
  });

  it('returns blocked side spans in the attached tier coordinate frame', () => {
    const building = compoundBuilding();
    const exposures = tierFacadeExposures(building, 1);
    const right = exposures[2];
    const halfDepth = building.tiers[1].depth / 2;

    expect(right.blockedSpans).toHaveLength(1);
    expect(right.blockedSpans[0].min).toBeCloseTo(-1.5);
    expect(right.blockedSpans[0].max).toBeCloseTo(-0.84);
    expect(right.blockedSpans[0].min).toBeGreaterThanOrEqual(-halfDepth);
    expect(right.blockedSpans[0].max).toBeLessThanOrEqual(halfDepth);
    expect(isFacadeSpanExposed(right, -1.1, 0.5, 0.35)).toBe(false);
    expect(isFacadeSpanExposed(right, 1.1, 0.5, 0.35)).toBe(true);
  });

  it('keeps default-world blocked spans inside every tier face', () => {
    const world = generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS });

    for (const building of world.buildings) {
      building.tiers.forEach((tier, tierIndex) => {
        const exposures = tierFacadeExposures(building, tierIndex);
        exposures.forEach((exposure, faceIndex) => {
          const half = faceIndex < 2 ? tier.width / 2 : tier.depth / 2;
          for (const span of exposure.blockedSpans) {
            expect(span.min).toBeGreaterThanOrEqual(-half);
            expect(span.max).toBeLessThanOrEqual(half);
          }
        });
      });
    }
  });
});
