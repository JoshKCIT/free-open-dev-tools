import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
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
 * A draggable `{ x, y }` handle with paired numeric inputs.
 * The handle is a keyboard-operable slider (WAI-ARIA 1.2's slider role,
 * https://www.w3.org/TR/wai-aria-1.2/#slider: "An input where the user
 * selects a value from within a given range... Authors MUST set the
 * aria-valuenow attribute", accessible name required) representing the
 * horizontal axis's own min/max/now, with `aria-valuetext` naming both
 * axes' values (the two-axis colour-picker convention: one slider element,
 * both values in its value text) -- and the two numeric inputs, each with
 * its own accessible name, are a second, always-available keyboard path.
 *
 * Keyboard interaction on the handle follows the ARIA Authoring Practices
 * Guide's own slider pattern (arrow keys step by one, Home/End jump to the
 * bounds, Page Up/Down make a larger jump), adapted to two axes: ArrowLeft
 * and ArrowRight change the horizontal value, ArrowUp and ArrowDown the
 * vertical value with ArrowDown increasing it (matching the pad's own
 * top-to-bottom, min-to-max layout -- the APG's own note that "reversing
 * the direction... could create a more intuitive experience" applies
 * exactly here), Shift multiplies the step by ten, Home and End set the
 * horizontal minimum and maximum, and Page Up and Page Down set the
 * vertical minimum and maximum.
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

  const onHandleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const s = step * (e.shiftKey ? 10 : 1);
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        write(x - s, y);
        break;
      case 'ArrowRight':
        e.preventDefault();
        write(x + s, y);
        break;
      case 'ArrowUp':
        // Up moves the handle toward the pad's own top, which is the
        // vertical minimum -- so it decreases y.
        e.preventDefault();
        write(x, y - s);
        break;
      case 'ArrowDown':
        e.preventDefault();
        write(x, y + s);
        break;
      case 'Home':
        e.preventDefault();
        write(min, y);
        break;
      case 'End':
        e.preventDefault();
        write(max, y);
        break;
      case 'PageUp':
        e.preventDefault();
        write(x, min);
        break;
      case 'PageDown':
        e.preventDefault();
        write(x, max);
        break;
      default:
        break;
    }
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
        <div
          className="point-handle"
          role="slider"
          tabIndex={0}
          aria-labelledby={labelId}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={x}
          aria-valuetext={`${axisX} ${x}, ${axisY} ${y}`}
          onKeyDown={onHandleKeyDown}
          style={{ left: `${fx}%`, top: `${fy}%` }}
        />
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
