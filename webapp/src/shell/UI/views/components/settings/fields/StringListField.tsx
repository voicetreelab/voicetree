import { useState } from 'react';
import type { JSX } from 'react';
import { X } from 'lucide-react';

interface StringListFieldProps {
  label: string;
  description?: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export function StringListField({ label, description, value, onChange }: StringListFieldProps): JSX.Element {
  const [input, setInput] = useState('');

  function addItem(): void {
    const trimmed: string = input.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
    setInput('');
  }

  function removeItem(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <div className="font-mono text-sm text-foreground">{label}</div>
        {description && (
          <div className="text-muted-foreground text-xs mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((item, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs font-mono text-foreground"
          >
            {item}
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Remove ${item}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add item..."
          className="min-w-[120px] flex-1 bg-input border border-border rounded-md px-2 py-0.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  );
}
