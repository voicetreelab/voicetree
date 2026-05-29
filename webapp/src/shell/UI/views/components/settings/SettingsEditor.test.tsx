// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings';
import type { VTSettings } from '@vt/graph-model/settings';

import { SettingsEditor } from './SettingsEditor';

function renderSettingsEditor(initialSettings: VTSettings = DEFAULT_SETTINGS): RenderResult & { readonly onSave: Mock } {
    const onSave: Mock = vi.fn(async () => undefined);
    return {
        ...render(<SettingsEditor initialSettings={initialSettings} onSave={onSave} />),
        onSave,
    };
}

describe('SettingsEditor', () => {
    it('flushes pending agent edits when unmounted before the debounce fires', () => {
        const { unmount, onSave } = renderSettingsEditor({
            ...DEFAULT_SETTINGS,
            agents: [{ name: 'Existing', command: 'existing "$AGENT_PROMPT"' }],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Agent' }));

        unmount();

        expect(onSave).toHaveBeenCalledTimes(1);
        const saved: VTSettings = onSave.mock.calls[0]?.[0] as VTSettings;
        expect(saved.agents).toEqual([
            { name: 'Existing', command: 'existing "$AGENT_PROMPT"' },
            { name: '', command: '' },
        ]);
    });
});
