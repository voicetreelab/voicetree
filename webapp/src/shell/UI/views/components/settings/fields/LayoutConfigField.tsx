import { useCallback } from 'react';
import type { JSX, ChangeEvent } from 'react';

type LayoutEngineOption = {
  readonly value: string;
  readonly label: string;
};

interface LayoutConfigFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

const LAYOUT_ENGINE_OPTIONS: readonly LayoutEngineOption[] = [
  { value: 'forceatlas2', label: 'ForceAtlas2' },
  { value: 'combocombined', label: 'ComboCombined' },
  { value: 'mindmap', label: 'Mindmap' },
  { value: 'webcola', label: 'WebCoLA' },
];

const VALID_ENGINES: ReadonlySet<string> = new Set<string>(LAYOUT_ENGINE_OPTIONS.map((option) => option.value));

const parseConfig = (value: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
};

const engineFromConfig = (value: string): string => {
  const parsed = parseConfig(value);
  const engine = parsed?.engine === 'cola' ? 'webcola' : parsed?.engine;
  return typeof engine === 'string' && VALID_ENGINES.has(engine) ? engine : 'forceatlas2';
};

const setEngineInConfig = (value: string, engine: string): string => {
  const parsed = parseConfig(value) ?? {};
  return JSON.stringify({ ...parsed, engine }, null, 2);
};

export function LayoutConfigField({ label, value, onChange }: LayoutConfigFieldProps): JSX.Element {
  const selectedEngine = engineFromConfig(value);

  const handleEngineChange = useCallback((engine: string): void => {
    onChange(setEngineInConfig(value, engine));
  }, [onChange, value]);

  const handleTextChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-2 py-1.5 px-1">
      <span className="font-mono text-sm text-foreground">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        {LAYOUT_ENGINE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`
              flex items-center gap-2 rounded-md border border-border px-2.5 py-2
              text-sm text-foreground cursor-pointer transition-colors
              ${selectedEngine === option.value ? 'bg-primary/15 border-primary' : 'bg-background hover:bg-muted/50'}
            `}
          >
            <input
              type="radio"
              name="layout-engine"
              value={option.value}
              checked={selectedEngine === option.value}
              onChange={() => handleEngineChange(option.value)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span className="font-mono">{option.label}</span>
          </label>
        ))}
      </div>
      <textarea
        value={value}
        onChange={handleTextChange}
        rows={6}
        className="
          w-full rounded-md border border-border bg-background
          px-2.5 py-1.5 font-mono text-sm text-foreground
          placeholder:text-muted-foreground/50
          focus:outline-none focus:ring-1 focus:ring-ring
          transition-colors resize-y min-h-[120px]
        "
      />
    </div>
  );
}
