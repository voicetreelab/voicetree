// @vitest-environment jsdom

import { useState } from 'react';
import type { JSX } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@vt/graph-model/settings';
import type { EnvVarValue, VTSettings } from '@vt/graph-model/settings';

import { SettingsSection } from './SettingsSection';

function EnvSettingsHarness({ initialSettings }: {
    readonly initialSettings: VTSettings;
}): JSX.Element {
    const [settings, setSettings] = useState<VTSettings>(initialSettings);

    function updateSetting(key: string, value: unknown): void {
        setSettings(prev => ({ ...prev, [key]: value }));
    }

    return (
        <>
            <SettingsSection
                settings={settings}
                section="agents"
                onUpdate={updateSetting}
            />
            <output data-testid="env-vars">
                {JSON.stringify(settings.INJECT_ENV_VARS)}
            </output>
        </>
    );
}

function readRenderedEnvVars(): Record<string, EnvVarValue> {
    return JSON.parse(screen.getByTestId('env-vars').textContent ?? '{}') as Record<string, EnvVarValue>;
}

describe('SettingsSection agent environment variables', () => {
    it('adds environment variables to the rendered settings value', () => {
        render(
            <EnvSettingsHarness
                initialSettings={{
                    ...DEFAULT_SETTINGS,
                    INJECT_ENV_VARS: {
                        AGENT_PROMPT: 'base prompt',
                    },
                }}
            />,
        );

        fireEvent.change(screen.getByLabelText('New environment variable name'), {
            target: { value: 'CUSTOM_CONTEXT' },
        });
        fireEvent.change(screen.getByLabelText('New environment variable value'), {
            target: { value: 'context=$CONTEXT_NODE_PATH' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add environment variable' }));

        expect(readRenderedEnvVars()).toEqual({
            AGENT_PROMPT: 'base prompt',
            CUSTOM_CONTEXT: 'context=$CONTEXT_NODE_PATH',
        });
    });

    it('removes environment variables from the rendered settings value', () => {
        render(
            <EnvSettingsHarness
                initialSettings={{
                    ...DEFAULT_SETTINGS,
                    INJECT_ENV_VARS: {
                        AGENT_PROMPT: 'base prompt',
                        STALE_VAR: 'remove me',
                    },
                }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Remove environment variable STALE_VAR' }));

        expect(readRenderedEnvVars()).toEqual({
            AGENT_PROMPT: 'base prompt',
        });
    });
});
