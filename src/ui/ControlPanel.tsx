/**
 * The single non-modal control panel: seed row, randomize, the seven sliders,
 * Generate, Reset Camera and the read-only summary. On wide screens it docks as
 * a side panel; on phones it opens downward from the same top-right control
 * point. Either way it can be collapsed so the diorama stays the focus.
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
  const loadLabel = props.summary.complexity.replace(/\s*\(.*/, '');
  const chips = [
    `${props.summary.buildingCount} structures`,
    props.summary.hasWalls ? 'Walls' : 'Open',
    props.summary.bridgeCount > 0 ? `${props.summary.bridgeCount} bridges` : 'No bridges',
    `${loadLabel} load`,
  ];

  return (
    <aside className={`panel ${open ? 'open' : 'collapsed'}`} aria-label="World controls">
      <div className="panel-top">
        <button
          className="panel-handle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="panel-body"
        >
          <span className="panel-handle-label">Controls</span>
          <span className="panel-toggle-caret" aria-hidden="true" />
        </button>
      </div>

      <div className="panel-body" id="panel-body" hidden={!open}>
        <div className="world-status">
          <div className="section-label">World</div>
          <div className="summary-chips" aria-label="Current world summary">
            {chips.map((chip) => (
              <span className="summary-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="panel-scroll">
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
            <button className="btn seed-random" onClick={props.onRandomize}>
              Random seed
            </button>
          </div>

          <Summary summary={props.summary} />

          <div className="parameter-section">
            <div className="section-label">Parameters</div>
            {PARAM_META.map((meta) => (
              <Slider
                key={meta.key}
                meta={meta}
                value={props.params[meta.key]}
                onChange={props.onParamChange}
              />
            ))}
          </div>
        </div>

        <div className="panel-footer">
          <div className="actions">
            <button className="btn primary" onClick={props.onGenerate} disabled={props.generating}>
              {props.generating ? 'Generating…' : 'Generate'}
            </button>
            <button className="btn" onClick={props.onResetCamera}>
              Reset camera
            </button>
          </div>
          <p className="hint">Drag orbit · Pinch/scroll zoom · Right-drag pan</p>
        </div>
      </div>
    </aside>
  );
}
