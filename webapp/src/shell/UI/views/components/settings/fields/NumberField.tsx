import { useCallback } from 'react';
import type { JSX, ChangeEvent } from 'react';

interface FieldProps<T> {
  label: string;
  description?: string;
  value: T;
  onChange: (value: T) => void;
}

interface NumberFieldProps extends FieldProps<number> {
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
}

function clampValue(val: number, min: number | undefined, max: number | undefined): number {
  let clamped: number = val;
  if (min !== undefined && clamped < min) clamped = min;
  if (max !== undefined && clamped > max) clamped = max;
  return clamped;
}

export function NumberField({ label, description, value, onChange, min, max, step = 1, slider }: NumberFieldProps): JSX.Element {
  const handleIncrement: () => void = useCallback(() => {
    onChange(clampValue(value + step, min, max));
  }, [value, step, min, max, onChange]);

  const handleDecrement: () => void = useCallback(() => {
    onChange(clampValue(value - step, min, max));
  }, [value, step, min, max, onChange]);

  const handleSliderChange: (e: ChangeEvent<HTMLInputElement>) => void = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    onChange(clampValue(parseFloat(e.target.value), min, max));
  }, [min, max, onChange]);

  const handleInputChange: (e: ChangeEvent<HTMLInputElement>) => void = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const parsed: number = parseFloat(e.target.value);
    if (!Number.isNaN(parsed)) {
      onChange(clampValue(parsed, min, max));
    }
  }, [min, max, onChange]);

  // Round display value to avoid floating point noise
  const displayValue: string = Number.isInteger(step) ? String(value) : value.toFixed(1);

  if (slider) {
    return (
      <div className="flex flex-col gap-1.5 py-1.5 px-1">
        <div className="flex justify-between items-center">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-mono text-sm text-foreground">{label}</span>
            {description && (
              <span className="text-muted-foreground text-xs">{description}</span>
            )}
          </div>
          <span className="font-mono text-sm text-muted-foreground tabular-nums ml-3">{displayValue}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          className="
            w-full h-1.5 rounded-full appearance-none cursor-pointer
            bg-input accent-primary
          "
        />
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center py-1.5 px-1">
      <div className="flex flex-col gap-0.5 min-w-0 mr-4">
        <span className="font-mono text-sm text-foreground">{label}</span>
        {description && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      <div className="flex items-center gap-0">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={min !== undefined && value <= min}
          className="
            h-7 w-7 flex items-center justify-center
            rounded-l-md border border-border bg-muted
            text-foreground text-sm
            hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed
            transition-colors
          "
        >
          &minus;
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={displayValue}
          onChange={handleInputChange}
          className="
            h-7 w-12 text-center
            border-y border-border bg-background
            font-mono text-sm text-foreground
            focus:outline-none focus:ring-1 focus:ring-ring
          "
        />
        <button
          type="button"
          onClick={handleIncrement}
          disabled={max !== undefined && value >= max}
          className="
            h-7 w-7 flex items-center justify-center
            rounded-r-md border border-border bg-muted
            text-foreground text-sm
            hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed
            transition-colors
          "
        >
          +
        </button>
      </div>
    </div>
  );
}
