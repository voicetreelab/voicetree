import { useState, useRef, useEffect } from 'react';
import type { JSX } from 'react';
import { Plus, X } from 'lucide-react';
import type { AgentConfig } from '@vt/graph-model/pure/settings/types';

interface AgentListFieldProps {
  value: readonly AgentConfig[];
  onChange: (value: AgentConfig[]) => void;
  defaultAgent?: string;
  onDefaultChange: (name: string) => void;
}

export function AgentListField({ value, onChange, defaultAgent, onDefaultChange }: AgentListFieldProps): JSX.Element {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const nameRefs: React.MutableRefObject<(HTMLInputElement | null)[]> = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex !== null && nameRefs.current[focusIndex]) {
      nameRefs.current[focusIndex]?.focus();
      setFocusIndex(null);
    }
  }, [focusIndex, value.length]);

  // Resolve which agent is effectively the default (first if unset/not found)
  const effectiveDefault: string = (() => {
    if (defaultAgent && value.some(a => a.name === defaultAgent)) return defaultAgent;
    return value[0]?.name ?? '';
  })();

  function updateAgent(index: number, field: keyof AgentConfig, fieldValue: string): void {
    const oldName: string = value[index]?.name ?? '';
    const updated: AgentConfig[] = value.map((agent, i) =>
      i === index ? { ...agent, [field]: fieldValue } : { ...agent }
    );
    onChange(updated);
    // If we renamed the default agent, update the default to track the new name
    if (field === 'name' && oldName === effectiveDefault) {
      onDefaultChange(fieldValue);
    }
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
    const removedName: string = value[index]?.name ?? '';
    const updated: AgentConfig[] = value.filter((_, i) => i !== index);
    onChange(updated);
    // If we removed the default agent, reset to first remaining
    if (removedName === effectiveDefault && updated.length > 0) {
      onDefaultChange(updated[0]?.name ?? '');
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.map((agent, index) => (
        <div key={index} className="flex items-center gap-2">
          <button
            type="button"
            title={agent.name === effectiveDefault ? 'Default agent' : `Set ${agent.name || 'this agent'} as default`}
            onClick={() => { if (agent.name) onDefaultChange(agent.name); }}
            className="flex items-center justify-center w-4 h-4 shrink-0"
          >
            <span
              className={`block w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                agent.name === effectiveDefault
                  ? 'border-foreground bg-foreground'
                  : 'border-muted-foreground/50 hover:border-foreground'
              }`}
            >
              {agent.name === effectiveDefault && (
                <span className="block w-full h-full rounded-full bg-background scale-[0.35]" />
              )}
            </span>
          </button>
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
