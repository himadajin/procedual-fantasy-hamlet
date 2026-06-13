import type { Building, BuildingTier } from '../../generation/types';

export type FacadeFace = 'front' | 'back' | 'right' | 'left';

export interface FacadeExposure {
  face: FacadeFace;
  /** Blocked lateral spans in the rendered tier's own local coordinates. */
  blockedSpans: FacadeSpan[];
}

export interface FacadeSpan {
  min: number;
  max: number;
}

interface LocalRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

const FACE_SPECS: {
  face: FacadeFace;
  normalAxis: 'x' | 'z';
  normalSign: -1 | 1;
  lateralAxis: 'x' | 'z';
}[] = [
  // Building rotation defines front as local +Z: the entrance looks toward +Z.
  { face: 'front', normalAxis: 'z', normalSign: 1, lateralAxis: 'x' },
  { face: 'back', normalAxis: 'z', normalSign: -1, lateralAxis: 'x' },
  { face: 'right', normalAxis: 'x', normalSign: 1, lateralAxis: 'z' },
  { face: 'left', normalAxis: 'x', normalSign: -1, lateralAxis: 'z' },
];

const CONTACT_DEPTH = 0.22;
const OUTWARD_DEPTH = 0.12;
const EDGE_CLEARANCE = 0.16;

export function tierFacadeExposures(building: Building, tierIndex: number): FacadeExposure[] {
  const tier = building.tiers[tierIndex];
  const tierRect = rectFor(tier);

  return FACE_SPECS.map((spec) => {
    const plane = facePlane(tierRect, spec.normalAxis, spec.normalSign);
    const ownLat = rangeFor(tierRect, spec.lateralAxis);
    const ownLatOrigin = centerFor(tierRect, spec.lateralAxis);
    const ownHalf = spec.lateralAxis === 'x' ? tier.width / 2 : tier.depth / 2;
    const blockedSpans: FacadeSpan[] = [];

    building.tiers.forEach((other, otherIndex) => {
      if (otherIndex === tierIndex) return;
      const otherRect = rectFor(other);
      if (!hasMeaningfulVerticalOverlap(tierRect, otherRect)) return;
      if (!crossesFacePlane(otherRect, spec.normalAxis, spec.normalSign, plane)) return;

      const otherLat = rangeFor(otherRect, spec.lateralAxis);
      const overlap = intersect(ownLat, otherLat);
      if (!overlap) return;

      const localMin = Math.max(ownLat.min, overlap.min - EDGE_CLEARANCE) - ownLatOrigin;
      const localMax = Math.min(ownLat.max, overlap.max + EDGE_CLEARANCE) - ownLatOrigin;
      blockedSpans.push({
        min: clamp(localMin, -ownHalf, ownHalf),
        max: clamp(localMax, -ownHalf, ownHalf),
      });
    });

    return { face: spec.face, blockedSpans: mergeSpans(blockedSpans) };
  });
}

export function isFacadeSpanExposed(
  exposure: FacadeExposure,
  center: number,
  width: number,
  coverageThreshold = 0.45,
): boolean {
  const span = { min: center - width / 2, max: center + width / 2 };
  const spanWidth = Math.max(0.001, width);
  const covered = exposure.blockedSpans.reduce((sum, blocked) => {
    const overlap = intersect(span, blocked);
    return sum + (overlap ? overlap.max - overlap.min : 0);
  }, 0);
  return covered / spanWidth < coverageThreshold;
}

function rectFor(tier: BuildingTier): LocalRect {
  return {
    minX: tier.offsetX - tier.width / 2,
    maxX: tier.offsetX + tier.width / 2,
    minZ: tier.offsetZ - tier.depth / 2,
    maxZ: tier.offsetZ + tier.depth / 2,
    minY: tier.baseOffset,
    maxY: tier.baseOffset + tier.height,
  };
}

function facePlane(rect: LocalRect, axis: 'x' | 'z', sign: -1 | 1): number {
  if (axis === 'x') return sign > 0 ? rect.maxX : rect.minX;
  return sign > 0 ? rect.maxZ : rect.minZ;
}

function rangeFor(rect: LocalRect, axis: 'x' | 'z'): FacadeSpan {
  if (axis === 'x') return { min: rect.minX, max: rect.maxX };
  return { min: rect.minZ, max: rect.maxZ };
}

function centerFor(rect: LocalRect, axis: 'x' | 'z'): number {
  if (axis === 'x') return (rect.minX + rect.maxX) / 2;
  return (rect.minZ + rect.maxZ) / 2;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function crossesFacePlane(rect: LocalRect, axis: 'x' | 'z', sign: -1 | 1, plane: number): boolean {
  const min = axis === 'x' ? rect.minX : rect.minZ;
  const max = axis === 'x' ? rect.maxX : rect.maxZ;
  if (sign > 0) {
    return min < plane + CONTACT_DEPTH && max > plane + OUTWARD_DEPTH;
  }
  return max > plane - CONTACT_DEPTH && min < plane - OUTWARD_DEPTH;
}

function hasMeaningfulVerticalOverlap(a: LocalRect, b: LocalRect): boolean {
  const overlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return overlap > Math.min(1.2, (a.maxY - a.minY) * 0.35);
}

function intersect(a: FacadeSpan, b: FacadeSpan): FacadeSpan | null {
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  return max > min ? { min, max } : null;
}

function mergeSpans(spans: FacadeSpan[]): FacadeSpan[] {
  if (spans.length < 2) return spans;
  const sorted = [...spans].sort((a, b) => a.min - b.min);
  const merged: FacadeSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (!last || span.min > last.max) {
      merged.push({ ...span });
    } else {
      last.max = Math.max(last.max, span.max);
    }
  }
  return merged;
}
