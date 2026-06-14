import { DEFAULT_PARAMS, DEFAULT_SEED } from '../generation/params';
import { buildScenarioSearch, buildScenarioUrl, parseScenarioSearch } from './scenario';

describe('debug scenario URLs', () => {
  const localOrigin = `${'http'}://localhost:5173`;

  it('falls back to the default scenario when query parameters are absent', () => {
    expect(parseScenarioSearch('')).toEqual({
      seed: DEFAULT_SEED,
      params: DEFAULT_PARAMS,
      camera: undefined,
    });
  });

  it('parses seed, clamped params and camera state from the query string', () => {
    expect(
      parseScenarioSearch(
        '?seed=riverhold&worldScale=120&settlementPressure=42&waterPresence=-4&camera=1,2,3,4,5,6',
      ),
    ).toEqual({
      seed: 'riverhold',
      params: {
        ...DEFAULT_PARAMS,
        worldScale: 100,
        settlementPressure: 42,
        waterPresence: 0,
      },
      camera: {
        position: { x: 1, y: 2, z: 3 },
        target: { x: 4, y: 5, z: 6 },
      },
    });
  });

  it('ignores malformed camera state', () => {
    expect(parseScenarioSearch('?camera=1,2,not-a-number').camera).toBeUndefined();
  });

  it('serializes a complete scenario query with stable numeric camera formatting', () => {
    expect(
      buildScenarioSearch({
        seed: 'riverhold',
        params: {
          worldScale: 82,
          settlementPressure: 55,
          defensePressure: 70,
          prosperity: 60,
          terrainRuggedness: 50,
          waterPresence: 70,
          monumentality: 75,
        },
        camera: {
          position: { x: 1.23456, y: 2, z: -3.5 },
          target: { x: 0, y: 4.2, z: 8.0004 },
        },
      }),
    ).toBe(
      '?seed=riverhold&worldScale=82&settlementPressure=55&defensePressure=70&prosperity=60&terrainRuggedness=50&waterPresence=70&monumentality=75&camera=1.235%2C2%2C-3.5%2C0%2C4.2%2C8',
    );
  });

  it('builds scenario URLs without changing the current path or hash', () => {
    expect(
      buildScenarioUrl(`${localOrigin}/view?old=1#section`, {
        seed: 'riverhold',
        params: DEFAULT_PARAMS,
      }),
    ).toBe(
      `${localOrigin}/view?seed=riverhold&worldScale=65&settlementPressure=55&defensePressure=70&prosperity=60&terrainRuggedness=50&waterPresence=70&monumentality=75#section`,
    );
  });
});
