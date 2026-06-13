/**
 * App shell. Holds the draft seed/params, the currently displayed World, and the
 * regeneration lifecycle. The 3D viewer is always the star: the control panel is
 * a non-modal side panel (desktop) / bottom sheet (mobile), and regenerating
 * never navigates away — the old diorama stays on screen under a light
 * "Generating…" badge until the new one is ready.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { generateWorld } from './generation/generate';
import { DEFAULT_PARAMS, DEFAULT_SEED, type WorldParams } from './generation/params';
import type { World } from './generation/types';
import { Viewer } from './viewer/Viewer';
import { ControlPanel } from './ui/ControlPanel';

function randomSeed(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function App(): JSX.Element {
  // Draft inputs (edited freely; only applied on Generate).
  const [seed, setSeed] = useState<string>(DEFAULT_SEED);
  const [params, setParams] = useState<WorldParams>(DEFAULT_PARAMS);

  // The world currently on screen.
  const [world, setWorld] = useState<World>(() =>
    generateWorld({ seed: DEFAULT_SEED, params: DEFAULT_PARAMS }),
  );
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

  return (
    <div className="app">
      <div className="viewer-layer">
        <Viewer world={world} resetSignal={resetSignal} />
      </div>

      {generating && (
        <div className="generating-badge" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Generating…
        </div>
      )}

      <header className="title-bar">
        <h1>Procedural Fantasy Hamlet</h1>
        <p>A medieval fantasy diorama, grown from a seed</p>
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
