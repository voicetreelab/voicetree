import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import { Plus, X } from 'lucide-react';
import type { AgentConfig } from '@/pure/settings/types';

interface AgentListFieldProps {
  value: readonly AgentConfig[];
  onChange: (value: AgentConfig[]) => void;
}

export function AgentListField({ value, onChange }: AgentListFieldProps): JSX.Element {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const nameRefs: React.MutableRefObject<(HTMLInputElement | null)[]> = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex !== null && nameRefs.current[focusIndex]) {
      nameRefs.current[focusIndex]?.focus();
      setFocusIndex(null);
    }
  }, [focusIndex, value.length]);

  function updateAgent(index: number, field: keyof AgentConfig, fieldValue: string): void {
    const updated: AgentConfig[] = value.map((agent, i) =>
      i === index ? { ...agent, [field]: fieldValue } : { ...agent }
    );
    onChange(updated);
  }

  function addAgent(): void {
    const updated: AgentConfig[] = [...value, { name: '', command: '' }];
    onChange(updated);
    setFocusIndex(updated.length - 1);
  }

  function removeAgent(index: number): void {
    if (value.length === 1) {
      if (!confirm('Remove the last agent?')) return;
    }
    const updated: AgentConfig[] = value.filter((_, i) => i !== index);
    onChange(updated);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.map((agent, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            ref={(el) => { nameRefs.current[index] = el; }}
            type="text"
            value={agent.name}
            onChange={(e) => updateAgent(index, 'name', e.target.value)}
            placeholder="name"
            className="w-1/4 bg-input border border-border rounded-md px-2 py-1 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            value={agent.command}
            onChange={(e) => updateAgent(index, 'command', e.target.value)}
            placeholder="command"
            className="flex-1 bg-input border border-border rounded-md px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => removeAgent(index)}
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={`Remove agent ${agent.name || index}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addAgent}
        className="flex items-center gap-1 self-start px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
      >
        <Plus size={12} />
        Add Agent
      </button>
    </div>
  );
}
