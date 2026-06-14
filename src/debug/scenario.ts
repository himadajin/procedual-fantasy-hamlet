import {
  DEFAULT_PARAMS,
  DEFAULT_SEED,
  PARAM_META,
  clampParam,
  type WorldParams,
} from '../generation/params';

export interface DebugVec3 {
  x: number;
  y: number;
  z: number;
}

export interface DebugCamera {
  position: DebugVec3;
  target: DebugVec3;
}

export interface DebugCameraSnapshot extends DebugCamera {
  distance: number;
}

export interface DebugScenario {
  seed: string;
  params: WorldParams;
  camera?: DebugCamera;
}

function parseFinite(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCamera(value: string | null): DebugCamera | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((part) => parseFinite(part));
  if (parts.length !== 6 || parts.some((part) => part === null)) return undefined;
  const [px, py, pz, tx, ty, tz] = parts as [number, number, number, number, number, number];
  return {
    position: { x: px, y: py, z: pz },
    target: { x: tx, y: ty, z: tz },
  };
}

function formatNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

export function parseScenarioSearch(search: string): DebugScenario {
  const query = new URLSearchParams(search);
  const seed = query.get('seed')?.trim() || DEFAULT_SEED;
  const params = { ...DEFAULT_PARAMS };

  for (const meta of PARAM_META) {
    const value = parseFinite(query.get(meta.key));
    if (value !== null) params[meta.key] = clampParam(value);
  }

  return {
    seed,
    params,
    camera: parseCamera(query.get('camera')),
  };
}

export function buildScenarioSearch(scenario: DebugScenario): string {
  const query = new URLSearchParams();
  query.set('seed', scenario.seed);
  for (const meta of PARAM_META) query.set(meta.key, String(clampParam(scenario.params[meta.key])));

  if (scenario.camera) {
    const { position, target } = scenario.camera;
    query.set(
      'camera',
      [position.x, position.y, position.z, target.x, target.y, target.z]
        .map(formatNumber)
        .join(','),
    );
  }

  return `?${query.toString()}`;
}

export function buildScenarioUrl(baseHref: string, scenario: DebugScenario): string {
  const url = new URL(baseHref);
  url.search = buildScenarioSearch(scenario);
  return url.toString();
}
