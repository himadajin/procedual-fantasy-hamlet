/**
 * The single non-modal control panel: seed row, randomize, the seven sliders,
 * Generate, Reset Camera and the read-only summary. On wide screens it docks as
 * a side panel; on phones it becomes a bottom sheet with a drag handle. Either
 * way it can be collapsed so the diorama stays the focus.
 */
import { useState } from 'react';
import { PARAM_META, type WorldParams } from '../generation/params';
import type { WorldSummary } from '../generation/types';
import { Slider } from './Slider';
import { Summary } from './Summary';

interface ControlPanelProps {
  seed: string;
  params: WorldParams;
  summary: WorldSummary;
  generating: boolean;
  onSeedChange: (seed: string) => void;
  onParamChange: (key: keyof WorldParams, value: number) => void;
  onRandomize: () => void;
  onGenerate: () => void;
  onResetCamera: () => void;
}

export function ControlPanel(props: ControlPanelProps): JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <aside className={`panel ${open ? 'open' : 'collapsed'}`} aria-label="World controls">
      <button
        className="panel-handle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="panel-body"
      >
        <span className="grip" aria-hidden="true" />
        <span className="panel-handle-label">{open ? 'Hide controls' : 'Controls'}</span>
      </button>

      <div className="panel-body" id="panel-body" hidden={!open}>
        <div className="seed-row">
          <label htmlFor="seed">Seed</label>
          <input
            id="seed"
            type="text"
            value={props.seed}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => props.onSeedChange(e.target.value)}
          />
          <button className="btn ghost" onClick={props.onRandomize} title="Randomize seed">
            🎲
          </button>
        </div>

        <div className="actions">
          <button className="btn primary" onClick={props.onGenerate} disabled={props.generating}>
            {props.generating ? 'Generating…' : 'Generate'}
          </button>
          <button className="btn" onClick={props.onResetCamera}>
            Reset camera
          </button>
        </div>
        <p className="hint">
          Adjust the seed and sliders, then press Generate. Drag to orbit · pinch/scroll to zoom ·
          two-finger / right-drag to pan.
        </p>

        <div className="sliders">
          {PARAM_META.map((meta) => (
            <Slider
              key={meta.key}
              meta={meta}
              value={props.params[meta.key]}
              onChange={props.onParamChange}
            />
          ))}
        </div>

        <Summary summary={props.summary} />
      </div>
    </aside>
  );
}
