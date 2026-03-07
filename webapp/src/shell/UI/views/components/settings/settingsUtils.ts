import { SETTINGS_SCHEMA } from '@/pure/settings/settingsSchema';
import type { Section, NumberFieldConfig } from '@/pure/settings/settingsSchema';

export type { Section, NumberFieldConfig };
export type FieldType = 'toggle' | 'number' | 'text' | 'textarea' | 'hotkey-group' | 'agent-list' | 'string-list' | 'key-value' | 'hook-group';

export function inferFieldType(key: string, value: unknown): FieldType {
    if (key === 'hotkeys') return 'hotkey-group';
    if (key === 'agents') return 'agent-list';
    if (key === 'hooks') return 'hook-group';
    if (key === 'INJECT_ENV_VARS') return 'key-value';
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
