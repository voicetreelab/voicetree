import type { JSX } from 'react';

interface FieldProps<T> {
  label: string;
  description?: string;
  value: T;
  onChange: (value: T) => void;
}

export function ToggleField({ label, description, value, onChange }: FieldProps<boolean>): JSX.Element {
  return (
    <div className="flex justify-between items-center py-1.5 px-1">
      <div className="flex flex-col gap-0.5 min-w-0 mr-4">
        <span className="font-mono text-sm text-foreground">{label}</span>
        {description && (
          <span className="text-muted-foreground text-xs">{description}</span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`
          relative inline-flex h-5 w-9 shrink-0 cursor-pointer
          rounded-full border border-border
          transition-colors duration-200 ease-in-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          ${value ? 'bg-primary' : 'bg-input'}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-4 w-4
            rounded-full bg-background shadow-sm
            transition-transform duration-200 ease-in-out
            ${value ? 'translate-x-4' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  );
}
