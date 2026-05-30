import { SETTINGS_SCHEMA } from '@vt/graph-model/settings';
import type { Section, NumberFieldConfig, SelectOption } from '@vt/graph-model/settings';

export type { Section, NumberFieldConfig, SelectOption };
export type FieldType = 'toggle' | 'number' | 'select' | 'text' | 'textarea' | 'hotkey-group' | 'agent-list' | 'string-list' | 'key-value' | 'hook-group' | 'layout-config';

export function inferFieldType(key: string, value: unknown): FieldType {
    if (key === 'hotkeys') return 'hotkey-group';
    if (key === 'agents') return 'agent-list';
    if (key === 'hooks') return 'hook-group';
    if (key === 'INJECT_ENV_VARS') return 'key-value';
    if (key === 'layoutConfig') return 'layout-config';
    if (SELECT_FIELD_OPTIONS[key]) return 'select';
    if (typeof value === 'boolean') return 'toggle';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string' && (value.includes('\n') || value.length > 100)) return 'textarea';
    if (typeof value === 'string') return 'text';
    if (Array.isArray(value)) return 'string-list';
    return 'text';
}

export function keyToLabel(key: string): string {
    const entry: { readonly label?: string } | undefined = (SETTINGS_SCHEMA as Record<string, { readonly label?: string }>)[key];
    if (entry?.label) return entry.label;
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

export const SECTION_MAP: Record<string, Section> = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA)
        .filter(([, v]) => !('hidden' in v && v.hidden))
        .map(([k, v]) => [k, v.section ?? 'advanced'])
) as Record<string, Section>;

export const HIDDEN_KEYS: Set<string> = new Set(
    Object.entries(SETTINGS_SCHEMA)
        .filter(([, v]) => 'hidden' in v && v.hidden)
        .map(([k]) => k)
);

export const NUMBER_FIELD_CONFIG: Record<string, NumberFieldConfig> = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA)
        .filter(([, v]) => 'number' in v && v.number)
        .map(([k, v]) => [k, v.number])
) as Record<string, NumberFieldConfig>;

export const SELECT_FIELD_OPTIONS: Record<string, readonly SelectOption[]> = Object.fromEntries(
    Object.entries(SETTINGS_SCHEMA)
        .filter(([, v]) => 'options' in v && v.options)
        .map(([k, v]) => [k, v.options])
) as Record<string, readonly SelectOption[]>;
