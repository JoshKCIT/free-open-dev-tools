import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef } from 'react';
import type { Field } from '../lib/tool-ui';

interface PointValue {
  x: number;
  y: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function roundToStep(v: number, step: number): number {
  if (!step) return v;
  return Math.round(v / step) * step;
}

/**
 * A draggable `{ x, y }` handle with paired numeric inputs (D-111, D-112).
 * The pad's own handle is pointer-only in this file's first form
 * (`aria-hidden`, not focusable): the two numeric inputs, each with its own
 * accessible name (the field label plus the axis name), are the keyboard
 * path. A later change makes the handle itself a keyboard-operable slider
 * as well.
 */
export default function PointField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${field.name}`;
  const labelId = `${id}-label`;
  const describedBy = field.help ? `${id}-help` : undefined;
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? 1;
  const [axisX, axisY] = field.axes ?? ['X', 'Y'];
  const padRef = useRef<HTMLDivElement>(null);

  const v = (value ?? {}) as Partial<PointValue>;
  const x = typeof v.x === 'number' && Number.isFinite(v.x) ? v.x : min;
  const y = typeof v.y === 'number' && Number.isFinite(v.y) ? v.y : min;

  const write = useCallback(
    (nx: number, ny: number) => {
      onChange({ x: clamp(roundToStep(nx, step), min, max), y: clamp(roundToStep(ny, step), min, max) });
    },
    [onChange, min, max, step],
  );

  const fromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const pad = padRef.current;
      if (!pad) return;
      const rect = pad.getBoundingClientRect();
      const fx = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
      const fy = rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0;
      write(min + fx * (max - min), min + fy * (max - min));
    },
    [write, min, max],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e.clientX, e.clientY);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    fromPointer(e.clientX, e.clientY);
  };

  const span = max - min || 1;
  const fx = ((x - min) / span) * 100;
  const fy = ((y - min) / span) * 100;

  const onNumberChange = (axis: 'x' | 'y') => (raw: string) => {
    if (raw === '') return; // an empty entry keeps the previous value
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    write(axis === 'x' ? parsed : x, axis === 'y' ? parsed : y);
  };

  return (
    <div className="field point-field" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
      <span className="field-label" id={labelId}>
        {field.label}
      </span>
      <div
        ref={padRef}
        className="point-pad"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <div className="point-handle" aria-hidden="true" style={{ left: `${fx}%`, top: `${fy}%` }} />
      </div>
      <div className="point-inputs">
        <label htmlFor={`${id}-x`}>
          {axisX}
          <input
            id={`${id}-x`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={x}
            aria-label={`${field.label} ${axisX}`}
            onChange={(e) => onNumberChange('x')(e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-y`}>
          {axisY}
          <input
            id={`${id}-y`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={y}
            aria-label={`${field.label} ${axisY}`}
            onChange={(e) => onNumberChange('y')(e.target.value)}
          />
        </label>
      </div>
      {field.help ? (
        <p className="field-help" id={`${id}-help`}>
          {field.help}
        </p>
      ) : null}
    </div>
  );
}
