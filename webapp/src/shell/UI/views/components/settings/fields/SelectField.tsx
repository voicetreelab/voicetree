import type { JSX } from 'react';
import type { SelectOption } from '../settingsUtils';

interface SelectFieldProps {
  label: string;
  description?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

export function SelectField({ label, description, value, options, onChange }: SelectFieldProps): JSX.Element {
  const selected: SelectOption | undefined = options.find(o => o.value === value);
  return (
    <div className="flex justify-between items-center py-1.5 px-1 gap-4">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-mono text-sm text-foreground">{label}</span>
        {(description ?? selected?.label) && (
          <span className="text-muted-foreground text-xs truncate">{description ?? selected?.label}</span>
        )}
      </div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="shrink-0 bg-input text-foreground text-xs font-mono border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
