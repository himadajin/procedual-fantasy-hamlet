/**
 * The data model of a generated diorama. The generator produces a `World`;
 * the renderer is a pure function of it. No geometry, colors or three.js types
 * leak in here — only plain, serializable description.
 */
import type { WorldParams } from './params';

export interface Vec2 {
  x: number;
  z: number;
}

/** Heightfield sampled on a regular grid covering [-half, half] in X and Z. */
export interface TerrainData {
  /** Number of vertices per side (grid is size x size). */
  size: number;
  /** World-space half extent; the grid spans [-half, half]. */
  half: number;
  /** Row-major elevation values, length size*size. */
  heights: Float32Array;
  /** Spacing between grid samples in world units. */
  cellSize: number;
  minHeight: number;
  maxHeight: number;
}

export type WaterBodyKind = 'river' | 'lake' | 'pond' | 'moat';

export interface WaterData {
  /** World Y of the water surface. */
  level: number;
  /** Row-major mask aligned to terrain grid: 1 = water cell, 0 = land. */
  mask: Uint8Array;
  /** Fraction of the grid covered by water, 0..1. */
  coverage: number;
  kinds: WaterBodyKind[];
  hasMoat: boolean;
  /** River centerline points in world space, if a river was carved. */
  riverPath: Vec2[];
}

export type RoadClass = 'main' | 'street' | 'lane';

export interface RoadSegment {
  points: Vec2[];
  width: number;
  klass: RoadClass;
}

export type PlazaKind = 'civic' | 'market' | 'gate' | 'bridge' | 'courtyard';

export interface Plaza {
  center: Vec2;
  radius: number;
  kind: PlazaKind;
}

export type BuildingRole =
  | 'monument'
  | 'dwelling'
  | 'tower'
  | 'gatehouse'
  | 'wallhouse'
  | 'waterside'
  | 'bridgehouse'
  | 'hall'
  | 'workshop'
  | 'outlier';

export type RoofKind = 'gable' | 'hip' | 'pyramid' | 'spire' | 'flat' | 'shed';
export type WallMaterial = 'stone' | 'timber' | 'plaster' | 'halfTimber';

export interface BuildingTier {
  /** Footprint width (X, local) and depth (Z, local) for this stacked tier. */
  width: number;
  depth: number;
  /** Height of the walls of this tier. */
  height: number;
  /** Vertical offset of the tier base above the building base. */
  baseOffset: number;
  /** Local center offset relative to the building origin (for L/T plans). */
  offsetX: number;
  offsetZ: number;
  /** Optional per-mass roof override; falls back to the building roof. */
  roof?: RoofKind;
  /** Local yaw offset for this mass roof, relative to building rotation. */
  roofYaw?: number;
}

export interface Building {
  id: number;
  role: BuildingRole;
  /** World position of the building origin (footprint center). */
  position: Vec2;
  /** Ground elevation the building sits on (terraced). */
  ground: number;
  /** Facing angle in radians (0 = facing +Z), where the entrance looks. */
  rotation: number;
  /** Stacked rectangular masses forming the body. */
  tiers: BuildingTier[];
  roof: RoofKind;
  roofHeight: number;
  /** Roof eave overhang. */
  overhang: number;
  wallMaterial: WallMaterial;
  /** 0..1 refinement: window density, beams, trim. */
  refinement: number;
  /** Corner/attached turrets (count). */
  turrets: number;
  hasChimney: boolean;
  /** For waterside buildings: stilt foundation height above water bed. */
  stiltHeight: number;
  /** Approx storeys, used to seed window rows. */
  storeys: number;
}

export interface Tower {
  position: Vec2;
  ground: number;
  radius: number;
  height: number;
  /** 'round' towers use cylinders, 'square' use boxes. */
  shape: 'round' | 'square';
  hasRoof: boolean;
  crenellated: boolean;
}

export interface Gate {
  position: Vec2;
  ground: number;
  rotation: number;
  width: number;
  height: number;
}

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  /** Ground elevations at each end (the wall top stays roughly level per span). */
  groundA: number;
  groundB: number;
  height: number;
  thickness: number;
  crenellated: boolean;
}

export interface Bridge {
  a: Vec2;
  b: Vec2;
  deckLevel: number;
  width: number;
  /** Whether a small structure sits on the bridge. */
  hasHouse: boolean;
}

export type PlantKind = 'tree' | 'pine' | 'shrub' | 'reed';

export interface Plant {
  position: Vec2;
  ground: number;
  kind: PlantKind;
  /** Overall scale multiplier. */
  scale: number;
}

export interface WorldSummary {
  seed: string;
  seedValue: number;
  params: WorldParams;
  buildingCount: number;
  monument: string;
  water: string;
  defenses: string;
  scale: string;
  complexity: string;
  /** Rough triangle budget estimate, for the load indicator. */
  triangleEstimate: number;
  vegetationCount: number;
  bridgeCount: number;
  towerCount: number;
  hasWalls: boolean;
  hasMoat: boolean;
}

export interface World {
  seed: string;
  seedValue: number;
  params: WorldParams;
  /** World-space half extent (terrain.half). */
  half: number;
  terrain: TerrainData;
  water: WaterData;
  center: Vec2;
  roads: RoadSegment[];
  plazas: Plaza[];
  buildings: Building[];
  walls: WallSegment[];
  towers: Tower[];
  gates: Gate[];
  bridges: Bridge[];
  plants: Plant[];
  summary: WorldSummary;
}
