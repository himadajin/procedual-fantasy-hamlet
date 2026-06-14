/**
 * App shell. Holds the draft seed/params, the currently displayed World, and the
 * regeneration lifecycle. The 3D viewer is always the star: the control panel is
 * a non-modal side panel / top-right dropdown, and regenerating
 * never navigates away — the old diorama stays on screen under a light
 * "Generating…" badge until the new one is ready.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildScenarioUrl,
  parseScenarioSearch,
  type DebugCamera,
  type DebugCameraSnapshot,
} from './debug/scenario';
import { buildWorldMetrics, type DebugWorldMetrics } from './debug/metrics';
import { generateWorld } from './generation/generate';
import type { WorldParams } from './generation/params';
import type { World } from './generation/types';
import { Viewer, type ViewerDebugHandle } from './viewer/Viewer';
import { ControlPanel } from './ui/ControlPanel';

interface HamletDebugState {
  seed: string;
  params: WorldParams;
  camera: DebugCameraSnapshot | null;
  scenarioUrl: string;
  world: {
    seed: string;
    seedValue: number;
    half: number;
    center: World['center'];
    summary: World['summary'];
    metrics: DebugWorldMetrics;
  };
}

interface HamletDebugApi {
  getState: () => HamletDebugState;
  scenarioUrl: () => string;
  setCamera: (camera: DebugCamera) => void;
}

declare global {
  interface Window {
    __hamletDebug?: HamletDebugApi;
  }
}

function sameCameraSnapshot(a: DebugCameraSnapshot | null, b: DebugCameraSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const valuesA = [
    a.position.x,
    a.position.y,
    a.position.z,
    a.target.x,
    a.target.y,
    a.target.z,
    a.distance,
  ];
  const valuesB = [
    b.position.x,
    b.position.y,
    b.position.z,
    b.target.x,
    b.target.y,
    b.target.z,
    b.distance,
  ];
  return valuesA.every((value, index) => Math.abs(value - valuesB[index]) < 0.001);
}

function randomSeed(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function App(): JSX.Element {
  const initialScenario = useMemo(() => parseScenarioSearch(window.location.search), []);
  const viewerDebug = useRef<ViewerDebugHandle>(null);

  // Draft inputs (edited freely; only applied on Generate).
  const [seed, setSeed] = useState<string>(initialScenario.seed);
  const [params, setParams] = useState<WorldParams>(initialScenario.params);

  // The world currently on screen.
  const [world, setWorld] = useState<World>(() =>
    generateWorld({ seed: initialScenario.seed, params: initialScenario.params }),
  );
  const [cameraSnapshot, setCameraSnapshot] = useState<DebugCameraSnapshot | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const pending = useRef(false);

  const setParam = useCallback((key: keyof WorldParams, value: number) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  const regenerate = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    setGenerating(true);
    // Let the "Generating…" badge paint before the (synchronous) heavy work.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const next = generateWorld({ seed, params });
        setWorld(next);
        setGenerating(false);
        pending.current = false;
      });
    });
  }, [seed, params]);

  const randomize = useCallback(() => setSeed(randomSeed()), []);
  const resetCamera = useCallback(() => setResetSignal((n) => n + 1), []);
  const updateCameraSnapshot = useCallback((camera: DebugCameraSnapshot | null) => {
    setCameraSnapshot((current) => (sameCameraSnapshot(current, camera) ? current : camera));
  }, []);

  const debugState = useMemo<HamletDebugState>(
    () => ({
      seed,
      params,
      camera: cameraSnapshot,
      scenarioUrl: buildScenarioUrl(window.location.href, {
        seed,
        params,
        camera: cameraSnapshot ?? undefined,
      }),
      world: {
        seed: world.seed,
        seedValue: world.seedValue,
        half: world.half,
        center: world.center,
        summary: world.summary,
        metrics: buildWorldMetrics(world),
      },
    }),
    [cameraSnapshot, params, seed, world],
  );

  // Keyboard nicety: "g" regenerates, "r" resets the camera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'g') regenerate();
      if (e.key === 'r') resetCamera();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [regenerate, resetCamera]);

  useEffect(() => {
    const getScenarioUrl = () =>
      buildScenarioUrl(window.location.href, {
        seed,
        params,
        camera: viewerDebug.current?.getCameraSnapshot() ?? undefined,
      });

    window.__hamletDebug = {
      getState: () => {
        const camera = viewerDebug.current?.getCameraSnapshot() ?? debugState.camera;
        return {
          ...debugState,
          camera,
          scenarioUrl: buildScenarioUrl(window.location.href, {
            seed,
            params,
            camera: camera ?? undefined,
          }),
        };
      },
      scenarioUrl: getScenarioUrl,
      setCamera: (camera) => viewerDebug.current?.setCamera(camera),
    };

    return () => {
      delete window.__hamletDebug;
    };
  }, [debugState, params, seed]);

  return (
    <div className="app">
      <div className="viewer-layer">
        <Viewer
          ref={viewerDebug}
          world={world}
          resetSignal={resetSignal}
          initialCamera={initialScenario.camera}
          onCameraSnapshotChange={updateCameraSnapshot}
        />
      </div>

      <output className="debug-state" data-testid="hamlet-debug-state" aria-hidden="true">
        {JSON.stringify(debugState)}
      </output>

      {generating && (
        <div className="generating-badge" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Generating…
        </div>
      )}

      <header className="title-bar">
        <h1>Procedural Fantasy Hamlet</h1>
      </header>

      <ControlPanel
        seed={seed}
        params={params}
        summary={world.summary}
        generating={generating}
        onSeedChange={setSeed}
        onParamChange={setParam}
        onRandomize={randomize}
        onGenerate={regenerate}
        onResetCamera={resetCamera}
      />
    </div>
  );
}
