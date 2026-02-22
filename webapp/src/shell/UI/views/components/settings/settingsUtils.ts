export type FieldType = 'toggle' | 'number' | 'text' | 'textarea' | 'hotkey-group' | 'agent-list' | 'string-list' | 'key-value' | 'hook-group';
export type Section = 'general' | 'shortcuts' | 'agents' | 'hooks' | 'advanced';

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
    const overrides: Record<string, string> = {
        'INJECT_ENV_VARS': 'Environment Variables',
        'shiftEnterSendsOptionEnter': 'Shift+Enter \u2192 Option+Enter',
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

export const HIDDEN_KEYS: Set<string> = new Set(['agentPermissionModeChosen', 'feedbackDialogShown', 'userEmail']);

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
