/**
 * The seven high-level parameters and the seed. These are the *only* inputs the
 * user controls. Everything in the world (terrain, water, roads, buildings,
 * walls, vegetation, materials) is derived from them — there are no mode toggles.
 */

export interface WorldParams {
  /** Overall extent of the diorama, amount of building, road & margin generosity. */
  worldScale: number;
  /** How readily buildings and roads cluster; central density and outward spread. */
  settlementPressure: number;
  /** Walls, towers, gates, moats, high-ground use, winding roads, guarded center. */
  defensePressure: number;
  /** Material quality, tidiness, roof/window/beam refinement, plaza neatness. */
  prosperity: number;
  /** 50 = ordinary hills; lower eases buildability, higher fragments it. */
  terrainRuggedness: number;
  /** How strongly watersides participate in structure, not raw water volume. */
  waterPresence: number;
  /** Size, rank and presence of the central monument; how space gathers around it. */
  monumentality: number;
}

export type ParamKey = keyof WorldParams;

export interface ParamMeta {
  key: ParamKey;
  label: string;
  jp: string;
  blurb: string;
}

export const PARAM_META: readonly ParamMeta[] = [
  {
    key: 'worldScale',
    label: 'World Scale',
    jp: '敷地規模',
    blurb: 'Overall size of the diorama and how much gets built.',
  },
  {
    key: 'settlementPressure',
    label: 'Settlement Pressure',
    jp: '居住圧力',
    blurb: 'How tightly buildings and streets gather toward the center.',
  },
  {
    key: 'defensePressure',
    label: 'Defense Pressure',
    jp: '防衛圧力',
    blurb: 'Walls, towers, gates, moats and winding, guarded approaches.',
  },
  {
    key: 'prosperity',
    label: 'Prosperity',
    jp: '繁栄度',
    blurb: 'Finer materials, tidier streets, better roofs and windows.',
  },
  {
    key: 'terrainRuggedness',
    label: 'Terrain Ruggedness',
    jp: '起伏の強さ',
    blurb: 'Below 50 is gentler; above 50 splits buildable land.',
  },
  {
    key: 'waterPresence',
    label: 'Water Presence',
    jp: '水辺の強さ',
    blurb: 'How strongly shores, bridges and water defenses shape the world.',
  },
  {
    key: 'monumentality',
    label: 'Monumentality',
    jp: '中心建築の格',
    blurb: 'Grandeur and presence of the single central monument.',
  },
] as const;

export const DEFAULT_PARAMS: WorldParams = {
  worldScale: 65,
  settlementPressure: 55,
  defensePressure: 70,
  prosperity: 60,
  terrainRuggedness: 50,
  waterPresence: 70,
  monumentality: 75,
};

export const DEFAULT_SEED = 'aldermarch';

/** Map a 0..100 parameter onto a normalized 0..1 fraction. */
export function frac(value: number): number {
  return clamp01(value / 100);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Map a 0..100 parameter onto a signed -1..1 deviation around the ordinary value 50. */
export function signedFromMid(value: number): number {
  return clamp01(value / 100) * 2 - 1;
}

export function clampParam(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function clampParams(p: WorldParams): WorldParams {
  return {
    worldScale: clampParam(p.worldScale),
    settlementPressure: clampParam(p.settlementPressure),
    defensePressure: clampParam(p.defensePressure),
    prosperity: clampParam(p.prosperity),
    terrainRuggedness: clampParam(p.terrainRuggedness),
    waterPresence: clampParam(p.waterPresence),
    monumentality: clampParam(p.monumentality),
  };
}
