/**
 * @deprecated Use settingsRegistry.ts instead for new code.
 * This file is kept for backward compatibility during migration.
 */

import type { FieldType, Section } from './settingsRegistry';
export type { FieldType, Section };

/**
 * @deprecated Use SETTINGS_REGISTRY from settingsRegistry.ts instead.
 * Infer field type from value - legacy approach, prefer explicit registry.
 */
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

/**
 * @deprecated Field labels are now defined in SETTINGS_REGISTRY.
 */
export function keyToLabel(key: string): string {
    const overrides: Record<string, string> = {
        'INJECT_ENV_VARS': 'Environment Variables',
        'shiftEnterSendsOptionEnter': 'Shift+Enter → Option+Enter',
        'terminalSpawnPathRelativeToWatchedDirectory': 'Terminal Spawn Path',
        'contextNodeMaxDistance': 'Context Distance',
        'askModeContextDistance': 'Ask Mode Distance',
        'autoNotifyUnseenNodes': 'Auto-notify Unseen Nodes',
        'defaultAllowlistPatterns': 'Default Allowlist Patterns',
        'zoomSensitivity': 'Zoom Sensitivity',
        'emptyFolderTemplate': 'Empty Folder Template',
        'shell': 'Shell Override',
        'starredFolders': 'Starred Folders',
        'showFps': 'Show FPS (WebGL)',
        'darkMode': 'Dark Mode',
        'vimMode': 'Vim Mode',
        'layoutConfig': 'Layout Config',
    };
    if (overrides[key]) return overrides[key];
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

/**
 * @deprecated Hidden status is now defined in SETTINGS_REGISTRY.
 */
export const HIDDEN_KEYS: Set<string> = new Set(['agentPermissionModeChosen', 'feedbackDialogShown', 'userEmail']);

/**
 * @deprecated Section mapping is now defined in SETTINGS_REGISTRY.
 */
export const SECTION_MAP: Record<string, Section> = {
    darkMode: 'general', vimMode: 'general',
    shiftEnterSendsOptionEnter: 'general', autoNotifyUnseenNodes: 'general',
    zoomSensitivity: 'general',
    terminalSpawnPathRelativeToWatchedDirectory: 'general',
    shell: 'general',
    emptyFolderTemplate: 'general',
    hotkeys: 'shortcuts',
    agents: 'agents', INJECT_ENV_VARS: 'agents',
    hooks: 'hooks',
    contextNodeMaxDistance: 'advanced', askModeContextDistance: 'advanced',
    defaultAllowlistPatterns: 'advanced', starredFolders: 'advanced',
    showFps: 'advanced',
    layoutConfig: 'advanced',
};
