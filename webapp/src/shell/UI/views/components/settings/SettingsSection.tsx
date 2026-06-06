import { useState, useCallback } from 'react';
import type { JSX } from 'react';
import { Plus, X } from 'lucide-react';
import type { VTSettings, HotkeySettings, HotkeyBinding, HookSettings, EnvVarValue, AgentConfig } from '@vt/graph-model/settings';
import { DEFAULT_HOTKEYS, isReservedAgentPromptEnvKey } from '@vt/graph-model/settings';
import { SECTION_MAP, HIDDEN_KEYS, NUMBER_FIELD_CONFIG, SELECT_FIELD_OPTIONS, inferFieldType, keyToLabel } from './settingsUtils';
import type { Section, FieldType, NumberFieldConfig, SelectOption } from './settingsUtils';
import { ToggleField } from './fields/ToggleField';
import { SelectField } from './fields/SelectField';
import { NumberField } from './fields/NumberField';
import { TextField } from './fields/TextField';
import { HotkeyField } from './fields/HotkeyField';
import { AgentListField } from './fields/AgentListField';
import { StringListField } from './fields/StringListField';
import { LayoutConfigField } from './fields/LayoutConfigField';

interface SettingsSectionProps {
    settings: VTSettings;
    section: Section;
    onUpdate: (key: string, value: unknown) => void;
}


/** Human-readable labels for hotkey binding keys */
const HOTKEY_LABELS: Record<string, string> = {
    fitToLastNode: 'Fit to Last Node',
    nextTerminal: 'Next Terminal',
    prevTerminal: 'Previous Terminal',
    createNewNode: 'Create New Node',
    runTerminal: 'Run Terminal',
    deleteSelectedNodes: 'Delete Selected',
    closeWindow: 'Close Window',
    openSettings: 'Open Settings',
    openSearch: 'Search',
    openSearchAlt: 'Search (Alt)',
    recentNode1: 'Recent Node 1',
    recentNode2: 'Recent Node 2',
    recentNode3: 'Recent Node 3',
    recentNode4: 'Recent Node 4',
    recentNode5: 'Recent Node 5',
    voiceRecording: 'Voice Recording',
};

/** Human-readable labels for hook keys */
const HOOK_LABELS: Record<string, { label: string; description: string }> = {
    onWorktreeCreatedBlocking: {
        label: 'On Worktree Created (Blocking)',
        description: 'Shell command run after git worktree add. Blocks terminal spawn. Receives worktree path as $1, name as $2.',
    },
    postWorktreeCreatedAsync: {
        label: 'Post Worktree Created (Async)',
        description: 'Shell command run after git worktree add. Fire-and-forget. Receives worktree path as $1, name as $2.',
    },
    onNewNode: {
        label: 'On New Node',
        description: 'Shell command run after a new node is created. Receives node path as $1.',
    },
};

/** Collapsible textarea for a single environment variable */
function EnvVarEntry({ envKey, value, onChange, onRemove }: {
    envKey: string;
    value: EnvVarValue;
    onChange: (newValue: string) => void;
    onRemove: () => void;
}): JSX.Element {
    const [expanded, setExpanded] = useState<boolean>(false);
    const strValue: string = typeof value === 'string' ? value : (value as readonly string[]).join('\n');
    const charCount: number = strValue.length;

    return (
        <div className="border border-border rounded-md overflow-hidden">
            <div className="flex items-center font-mono text-xs hover:bg-muted/50 transition-colors">
                <button
                    type="button"
                    onClick={() => setExpanded(prev => !prev)}
                    className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left"
                >
                    <span className="truncate text-foreground">{envKey}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">{expanded ? '▼' : '▶'} {charCount} chars</span>
                </button>
                <button
                    type="button"
                    aria-label={`Remove environment variable ${envKey}`}
                    title={`Remove ${envKey}`}
                    onClick={onRemove}
                    className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                    <X size={13} aria-hidden="true" />
                </button>
            </div>
            {expanded && (
                <textarea
                    value={strValue}
                    onChange={e => onChange(e.target.value)}
                    className="w-full px-3 py-2 bg-input text-foreground text-xs font-mono border-t border-border resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={Math.min(Math.max(strValue.split('\n').length, 3), 20)}
                />
            )}
        </div>
    );
}

function normalizeEnvVarKey(value: string): string {
    return value.trim();
}

function isValidEnvVarKey(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function EnvVarCreator({ existingKeys, onAdd }: {
    existingKeys: readonly string[];
    onAdd: (envKey: string, value: string) => void;
}): JSX.Element {
    const [keyInput, setKeyInput] = useState<string>('');
    const [valueInput, setValueInput] = useState<string>('');
    const normalizedKey: string = normalizeEnvVarKey(keyInput);
    const isDuplicate: boolean = existingKeys.includes(normalizedKey);
    const isReserved: boolean = isReservedAgentPromptEnvKey(normalizedKey);
    const canAdd: boolean = isValidEnvVarKey(normalizedKey) && !isDuplicate && !isReserved;
    const validationMessage: string | null = (() => {
        if (normalizedKey.length === 0) return null;
        if (!isValidEnvVarKey(normalizedKey)) return 'Names must start with a letter or underscore and contain only letters, numbers, and underscores.';
        if (isReserved) return 'AGENT_PROMPT_* variables are managed by prompt files. Edit AGENT_PROMPT to change prompt composition.';
        if (isDuplicate) return 'That environment variable already exists.';
        return null;
    })();

    function addEnvVar(): void {
        if (!canAdd) return;
        onAdd(normalizedKey, valueInput);
        setKeyInput('');
        setValueInput('');
    }

    return (
        <div className="border border-border rounded-md p-3 space-y-2">
            <div className="grid grid-cols-1 gap-2 items-start sm:grid-cols-[minmax(10rem,16rem)_1fr_auto]">
                <input
                    type="text"
                    value={keyInput}
                    onChange={event => setKeyInput(event.target.value)}
                    placeholder="CUSTOM_ENV_VAR"
                    aria-label="New environment variable name"
                    className="bg-input border border-border rounded-md px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <textarea
                    value={valueInput}
                    onChange={event => setValueInput(event.target.value)}
                    placeholder="value"
                    aria-label="New environment variable value"
                    rows={3}
                    className="min-h-16 bg-input border border-border rounded-md px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                    type="button"
                    onClick={addEnvVar}
                    disabled={!canAdd}
                    title="Add environment variable"
                    aria-label="Add environment variable"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                    <Plus size={14} aria-hidden="true" />
                </button>
            </div>
            {validationMessage !== null && (
                <div className="text-xs text-destructive">
                    {validationMessage}
                </div>
            )}
        </div>
    );
}

export function SettingsSection({ settings, section, onUpdate }: SettingsSectionProps): JSX.Element {
    // Get keys belonging to this section, excluding hidden keys
    const sectionKeys: string[] = Object.entries(SECTION_MAP)
        .filter(([, s]) => s === section)
        .map(([key]) => key)
        .filter(key => !HIDDEN_KEYS.has(key));

    const handleHotkeyUpdate: (hotkeyKey: string, binding: HotkeyBinding) => void = useCallback((hotkeyKey: string, binding: HotkeyBinding): void => {
        const currentHotkeys: HotkeySettings = settings.hotkeys ?? DEFAULT_HOTKEYS;
        onUpdate('hotkeys', { ...currentHotkeys, [hotkeyKey]: binding });
    }, [settings.hotkeys, onUpdate]);

    const handleHookUpdate: (hookKey: string, value: string) => void = useCallback((hookKey: string, value: string): void => {
        const currentHooks: HookSettings = settings.hooks ?? {};
        onUpdate('hooks', { ...currentHooks, [hookKey]: value });
    }, [settings.hooks, onUpdate]);

    const handleEnvVarUpdate: (envKey: string, value: string) => void = useCallback((envKey: string, value: string): void => {
        if (isReservedAgentPromptEnvKey(envKey)) return;
        const currentVars: Record<string, EnvVarValue> = settings.INJECT_ENV_VARS ?? {};
        onUpdate('INJECT_ENV_VARS', { ...currentVars, [envKey]: value });
    }, [settings.INJECT_ENV_VARS, onUpdate]);

    const handleEnvVarAdd: (envKey: string, value: string) => void = useCallback((envKey: string, value: string): void => {
        if (isReservedAgentPromptEnvKey(envKey)) return;
        const currentVars: Record<string, EnvVarValue> = settings.INJECT_ENV_VARS ?? {};
        if (Object.prototype.hasOwnProperty.call(currentVars, envKey)) return;
        onUpdate('INJECT_ENV_VARS', { ...currentVars, [envKey]: value });
    }, [settings.INJECT_ENV_VARS, onUpdate]);

    const handleEnvVarRemove: (envKey: string) => void = useCallback((envKey: string): void => {
        if (isReservedAgentPromptEnvKey(envKey)) return;
        const currentVars: Record<string, EnvVarValue> = settings.INJECT_ENV_VARS ?? {};
        const { [envKey]: _removed, ...remaining } = currentVars;
        onUpdate('INJECT_ENV_VARS', remaining);
    }, [settings.INJECT_ENV_VARS, onUpdate]);

    return (
        <div className="space-y-3">
            {sectionKeys.map(key => {
                const value: unknown = (settings as unknown as Record<string, unknown>)[key];
                const fieldType: FieldType = inferFieldType(key, value);
                const label: string = keyToLabel(key);

                switch (fieldType) {
                    case 'toggle':
                        return (
                            <ToggleField
                                key={key}
                                label={label}
                                value={value as boolean ?? false}
                                onChange={v => onUpdate(key, v)}
                            />
                        );

                    case 'number': {
                        const config: NumberFieldConfig | undefined = NUMBER_FIELD_CONFIG[key];
                        return (
                            <NumberField
                                key={key}
                                label={label}
                                value={value as number ?? 0}
                                min={config?.min}
                                max={config?.max}
                                step={config?.step}
                                slider={config?.slider}
                                onChange={v => onUpdate(key, v)}
                            />
                        );
                    }

                    case 'select': {
                        const options: readonly SelectOption[] = SELECT_FIELD_OPTIONS[key] ?? [];
                        return (
                            <SelectField
                                key={key}
                                label={label}
                                value={value as string ?? (options[0]?.value ?? '')}
                                options={options}
                                onChange={v => onUpdate(key, v)}
                            />
                        );
                    }

                    case 'text':
                        return (
                            <TextField
                                key={key}
                                label={label}
                                value={value as string ?? ''}
                                onChange={v => onUpdate(key, v)}
                            />
                        );

                    case 'textarea':
                        return (
                            <TextField
                                key={key}
                                label={label}
                                value={value as string ?? ''}
                                multiline
                                onChange={v => onUpdate(key, v)}
                            />
                        );

                    case 'layout-config':
                        return (
                            <LayoutConfigField
                                key={key}
                                label={label}
                                value={value as string ?? ''}
                                onChange={v => onUpdate(key, v)}
                            />
                        );

                    case 'hotkey-group': {
                        const hotkeys: HotkeySettings = (value as HotkeySettings | undefined) ?? DEFAULT_HOTKEYS;
                        return (
                            <div key={key} className="space-y-2">
                                {(Object.keys(hotkeys) as (keyof HotkeySettings)[]).map(hotkeyKey => (
                                    <HotkeyField
                                        key={hotkeyKey}
                                        label={HOTKEY_LABELS[hotkeyKey] ?? keyToLabel(hotkeyKey)}
                                        value={hotkeys[hotkeyKey]}
                                        onChange={binding => handleHotkeyUpdate(hotkeyKey, binding)}
                                    />
                                ))}
                            </div>
                        );
                    }

                    case 'agent-list':
                        return (
                            <AgentListField
                                key={key}
                                value={value as readonly AgentConfig[] ?? []}
                                onChange={v => onUpdate(key, v)}
                                defaultAgent={settings.defaultAgent}
                                onDefaultChange={v => onUpdate('defaultAgent', v)}
                            />
                        );

                    case 'string-list':
                        return (
                            <StringListField
                                key={key}
                                label={label}
                                value={value as readonly string[] ?? []}
                                onChange={v => onUpdate(key, v)}
                            />
                        );

                    case 'key-value': {
                        const envVars: Record<string, EnvVarValue> = (value as Record<string, EnvVarValue>) ?? {};
                        const visibleEnvVars: Record<string, EnvVarValue> = Object.fromEntries(
                            Object.entries(envVars).filter(([envKey]: readonly [string, EnvVarValue]): boolean => !isReservedAgentPromptEnvKey(envKey)),
                        ) as Record<string, EnvVarValue>;
                        return (
                            <div key={key} className="space-y-2">
                                <div className="font-mono text-sm text-foreground font-medium">{label}</div>
                                <EnvVarCreator
                                    existingKeys={Object.keys(envVars)}
                                    onAdd={handleEnvVarAdd}
                                />
                                {Object.entries(visibleEnvVars).map(([envKey, envValue]) => (
                                    <EnvVarEntry
                                        key={envKey}
                                        envKey={envKey}
                                        value={envValue}
                                        onChange={v => handleEnvVarUpdate(envKey, v)}
                                        onRemove={() => handleEnvVarRemove(envKey)}
                                    />
                                ))}
                            </div>
                        );
                    }

                    case 'hook-group': {
                        const hooks: HookSettings = (value as HookSettings | undefined) ?? {};
                        return (
                            <div key={key} className="space-y-3">
                                {Object.entries(HOOK_LABELS).map(([hookKey, meta]) => (
                                    <TextField
                                        key={hookKey}
                                        label={meta.label}
                                        description={meta.description}
                                        value={(hooks as Record<string, string | undefined>)[hookKey] ?? ''}
                                        placeholder="e.g. ./scripts/my-hook.sh"
                                        onChange={v => handleHookUpdate(hookKey, v)}
                                    />
                                ))}
                            </div>
                        );
                    }

                    default:
                        return null;
                }
            })}
        </div>
    );
}
