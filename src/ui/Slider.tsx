/**
 * A single labeled parameter slider (0..100) with a one-line description.
 * Dragging only edits the draft value; nothing regenerates until Generate.
 */
import type { FormEvent } from 'react';
import type { ParamMeta } from '../generation/params';

interface SliderProps {
  meta: ParamMeta;
  value: number;
  onChange: (key: ParamMeta['key'], value: number) => void;
}

export function Slider({ meta, value, onChange }: SliderProps): JSX.Element {
  const handleInput = (e: FormEvent<HTMLInputElement>) => {
    onChange(meta.key, Number(e.currentTarget.value));
  };

  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={`p-${meta.key}`}>
          {meta.label} <span className="slider-jp">/ {meta.jp}</span>
        </label>
        <output htmlFor={`p-${meta.key}`}>{value}</output>
      </div>
      <input
        id={`p-${meta.key}`}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-describedby={`d-${meta.key}`}
        onInput={handleInput}
        onChange={handleInput}
      />
      <p id={`d-${meta.key}`} className="slider-blurb">
        {meta.blurb}
      </p>
    </div>
  );
}
