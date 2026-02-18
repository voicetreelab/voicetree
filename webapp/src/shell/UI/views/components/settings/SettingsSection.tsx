import { useState, useCallback } from 'react';
import type { JSX } from 'react';
import type { VTSettings, HotkeySettings, HotkeyBinding, HookSettings, EnvVarValue, AgentConfig } from '@/pure/settings/types';
import { DEFAULT_HOTKEYS } from '@/pure/settings/DEFAULT_SETTINGS';
import { SECTION_MAP, HIDDEN_KEYS, inferFieldType, keyToLabel } from './settingsUtils';
import type { Section, FieldType } from './settingsUtils';
import { ToggleField } from './fields/ToggleField';
import { NumberField } from './fields/NumberField';
import { TextField } from './fields/TextField';
import { HotkeyField } from './fields/HotkeyField';
import { AgentListField } from './fields/AgentListField';
import { StringListField } from './fields/StringListField';

interface SettingsSectionProps {
    settings: VTSettings;
    section: Section;
    onUpdate: (key: string, value: unknown) => void;
}

/** Number field constraints keyed by settings key */
const NUMBER_FIELD_CONFIG: Record<string, { min: number; max: number; step: number; slider?: boolean }> = {
    zoomSensitivity: { min: 0.1, max: 5.0, step: 0.1, slider: true },
    contextNodeMaxDistance: { min: 1, max: 20, step: 1 },
    askModeContextDistance: { min: 1, max: 20, step: 1 },
};

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
function EnvVarEntry({ envKey, value, onChange }: {
    envKey: string;
    value: EnvVarValue;
    onChange: (newValue: string) => void;
}): JSX.Element {
    const [expanded, setExpanded] = useState<boolean>(false);
    const strValue: string = typeof value === 'string' ? value : (value as readonly string[]).join('\n');
    const charCount: number = strValue.length;

    return (
        <div className="border border-border rounded-md overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(prev => !prev)}
                className="flex items-center justify-between w-full px-3 py-2 text-left font-mono text-xs hover:bg-muted/50 transition-colors"
            >
                <span className="text-foreground">{envKey}</span>
                <span className="text-muted-foreground">
                    {expanded ? '▼' : '▶'} {charCount} chars
                </span>
            </button>
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
        const currentVars: Record<string, EnvVarValue> = settings.INJECT_ENV_VARS ?? {};
        onUpdate('INJECT_ENV_VARS', { ...currentVars, [envKey]: value });
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
                        const config: { min: number; max: number; step: number; slider?: boolean } | undefined = NUMBER_FIELD_CONFIG[key];
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
                        return (
                            <div key={key} className="space-y-2">
                                <div className="font-mono text-sm text-foreground font-medium">{label}</div>
                                {Object.entries(envVars).map(([envKey, envValue]) => (
                                    <EnvVarEntry
                                        key={envKey}
                                        envKey={envKey}
                                        value={envValue}
                                        onChange={v => handleEnvVarUpdate(envKey, v)}
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
