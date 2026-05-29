// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings';
import type { VTSettings } from '@vt/graph-model/settings';

import { SettingsEditor } from './SettingsEditor';

function renderSettingsEditor(initialSettings: VTSettings = DEFAULT_SETTINGS): RenderResult & { readonly savedSettings: readonly VTSettings[] } {
    const savedSettings: VTSettings[] = [];
    return {
        ...render(<SettingsEditor initialSettings={initialSettings} onSave={async (settings) => {
            savedSettings.push(settings);
        }} />),
        savedSettings,
    };
}

describe('SettingsEditor', () => {
    it('flushes pending agent edits when unmounted before the debounce fires', () => {
        const { unmount, savedSettings } = renderSettingsEditor({
            ...DEFAULT_SETTINGS,
            agents: [{ name: 'Existing', command: 'existing "$AGENT_PROMPT"' }],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }));

        unmount();

        expect(savedSettings).toEqual([{
            ...DEFAULT_SETTINGS,
            agents: [
                { name: 'Existing', command: 'existing "$AGENT_PROMPT"' },
                { name: '', command: '' },
            ],
        }]);
    });
});
