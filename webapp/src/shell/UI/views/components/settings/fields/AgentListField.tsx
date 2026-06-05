import { useState } from 'react';
import type { JSX } from 'react';
import { Plus, X, CornerDownRight } from 'lucide-react';
import type { AgentConfig, AgentPath } from '@vt/graph-model/settings';
import {
  updateAgentAt,
  removeAgentAt,
  addChildAt,
  appendAgent,
  flattenAgentTree,
  agentPathLabel,
  isAgentCategory,
  resolveDefaultAgent,
} from '@vt/graph-model/settings';

interface AgentListFieldProps {
  value: readonly AgentConfig[];
  onChange: (value: AgentConfig[]) => void;
  defaultAgent?: string;
  onDefaultChange: (name: string) => void;
}

const INPUT_CLASS = 'bg-input border border-border rounded-md px-2 py-1 font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring';

/**
 * Compact editor for a node's env map. Keeps its own row list so a half-typed
 * key persists while editing; only complete (non-empty-key) pairs are persisted.
 */
function EnvEditor({ env, onChange }: { env: Readonly<Record<string, string>> | undefined; onChange: (env: Record<string, string>) => void }): JSX.Element {
  const [pairs, setPairs] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(env ?? {}).map(([key, value]) => ({ key, value })),
  );

  function commit(next: { key: string; value: string }[]): void {
    setPairs(next);
    const obj: Record<string, string> = {};
    for (const { key, value } of next) if (key.trim()) obj[key.trim()] = value;
    onChange(obj);
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-0.5">
          <input
            type="text" value={pair.key} placeholder="ENV"
            onChange={(e) => commit(pairs.map((p, j) => j === i ? { ...p, key: e.target.value } : p))}
            className={`${INPUT_CLASS} text-[11px] w-20`}
          />
          <span className="text-muted-foreground/50 text-xs">=</span>
          <input
            type="text" value={pair.value} placeholder="val"
            onChange={(e) => commit(pairs.map((p, j) => j === i ? { ...p, value: e.target.value } : p))}
            className={`${INPUT_CLASS} text-[11px] w-16`}
          />
          <button type="button" aria-label="Remove env var"
            onClick={() => commit(pairs.filter((_, j) => j !== i))}
            className="flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground">
            <X size={11} />
          </button>
        </div>
      ))}
      <button type="button"
        onClick={() => commit([...pairs, { key: '', value: '' }])}
        className="flex items-center gap-0.5 px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground rounded hover:bg-muted">
        <Plus size={10} /> env
      </button>
    </div>
  );
}

export function AgentListField({ value, onChange, defaultAgent, onDefaultChange }: AgentListFieldProps): JSX.Element {
  // The default is stored as a leaf path label ('Codex / Remote / XHigh').
  const defaultLeaf = resolveDefaultAgent(value, defaultAgent);
  const effectiveDefaultLabel: string = defaultLeaf ? agentPathLabel(defaultLeaf.path) : '';

  /** Apply a tree edit and keep `defaultAgent` pointing at the same leaf (or reset if it vanished). */
  function applyChange(next: AgentConfig[]): void {
    const before: string[] = flattenAgentTree(value).map((l) => agentPathLabel(l.path));
    const after: string[] = flattenAgentTree(next).map((l) => agentPathLabel(l.path));
    onChange(next);
    if (after.includes(effectiveDefaultLabel)) return; // default leaf still present
    const defIdx: number = before.indexOf(effectiveDefaultLabel);
    const newLabel: string = (before.length === after.length && defIdx >= 0 && after[defIdx])
      ? after[defIdx]   // a rename — same leaf, new label
      : (after[0] ?? ''); // a removal of the default leaf — fall back to the first
    if (newLabel !== effectiveDefaultLabel) onDefaultChange(newLabel);
  }

  function renderNode(node: AgentConfig, path: AgentPath, depth: number): JSX.Element[] {
    const label: string = agentPathLabel([...flattenLabelPrefix(value, path)]);
    const isLeaf: boolean = !isAgentCategory(node);
    const rows: JSX.Element[] = [
      <div key={path.join('.')} className="flex items-center gap-2" style={{ paddingLeft: depth * 18 }}>
        {isLeaf ? (
          <button type="button"
            title={label === effectiveDefaultLabel ? 'Default agent' : `Set "${label}" as default`}
            onClick={() => { if (label) onDefaultChange(label); }}
            className="flex items-center justify-center w-4 h-4 shrink-0">
            <span className={`block w-3.5 h-3.5 rounded-full border-2 transition-colors ${
              label === effectiveDefaultLabel ? 'border-foreground bg-foreground' : 'border-muted-foreground/50 hover:border-foreground'}`}>
              {label === effectiveDefaultLabel && <span className="block w-full h-full rounded-full bg-background scale-[0.35]" />}
            </span>
          </button>
        ) : <span className="w-4 h-4 shrink-0 flex items-center justify-center text-muted-foreground/40"><CornerDownRight size={12} /></span>}
        <input
          type="text" value={node.name} placeholder="name"
          onChange={(e) => applyChange(updateAgentAt(value, path, { name: e.target.value }))}
          className={`${INPUT_CLASS} text-sm w-32`}
        />
        <input
          type="text" value={node.command ?? ''}
          placeholder={depth > 0 ? 'command (blank = inherit)' : 'command'}
          onChange={(e) => applyChange(updateAgentAt(value, path, { command: e.target.value }))}
          className={`${INPUT_CLASS} text-xs flex-1`}
        />
        <EnvEditor env={node.env} onChange={(env) => applyChange(updateAgentAt(value, path, { env }))} />
        <button type="button" title="Add sub-agent"
          onClick={() => applyChange(addChildAt(value, path, { name: '', command: '' }))}
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <CornerDownRight size={14} />
        </button>
        <button type="button" aria-label={`Remove agent ${node.name || agentPathLabel(path.map(String))}`}
          onClick={() => applyChange(removeAgentAt(value, path))}
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <X size={14} />
        </button>
      </div>,
    ];
    (node.children ?? []).forEach((child, i) => rows.push(...renderNode(child, [...path, i], depth + 1)));
    return rows;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {value.flatMap((node, i) => renderNode(node, [i], 0))}
      <button type="button"
        onClick={() => applyChange(appendAgent(value, { name: '', command: '' }))}
        className="flex items-center gap-1 self-start px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted">
        <Plus size={12} /> Add Agent
      </button>
    </div>
  );
}

/** Names along `path` through `agents`, e.g. [1,0,1] -> ['Codex','Local','XHigh']. */
function flattenLabelPrefix(agents: readonly AgentConfig[], path: AgentPath): string[] {
  const names: string[] = [];
  let level: readonly AgentConfig[] = agents;
  for (const idx of path) {
    const node: AgentConfig | undefined = level[idx];
    if (!node) break;
    names.push(node.name);
    level = node.children ?? [];
  }
  return names;
}
