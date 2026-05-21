import { describe, expect, it } from 'vitest';

import {
    formatShortcut,
    getModifierSymbol,
    getSpecialKeySymbol,
    isMacPlatform,
    platformFromRuntimePlatform,
} from './keyboardShortcutDisplay';

describe('keyboard shortcut display', () => {
    it('formats shortcuts from an explicit platform', () => {
        expect(formatShortcut('N', 'mac')).toBe('⌘N');
        expect(formatShortcut('N', 'non-mac')).toBe('Ctrl+N');
        expect(formatShortcut('Backspace', 'mac')).toBe('⌘⌫');
        expect(formatShortcut('Backspace', 'non-mac')).toBe('Ctrl+Backspace');
    });

    it('formats special keys without reading runtime globals', () => {
        expect(getModifierSymbol('mac')).toBe('⌘');
        expect(getModifierSymbol('non-mac')).toBe('Ctrl');
        expect(getSpecialKeySymbol('enter', 'mac')).toBe('⏎');
        expect(getSpecialKeySymbol('enter', 'non-mac')).toBe('Enter');
    });

    it('derives shortcut platforms from caller-provided platform strings', () => {
        expect(platformFromRuntimePlatform('darwin')).toBe('mac');
        expect(platformFromRuntimePlatform('MacIntel')).toBe('mac');
        expect(platformFromRuntimePlatform('Win32')).toBe('non-mac');
        expect(isMacPlatform(platformFromRuntimePlatform('iPhone'))).toBe(true);
    });
});
