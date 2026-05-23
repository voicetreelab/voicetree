import { describe, it, expect } from 'vitest';
import { createDefaultSettings } from './settingsSchema';

describe('DEFAULT_SETTINGS platform-specific env var syntax', () => {
  it('should use $env:AGENT_PROMPT syntax on Windows', async () => {
    const DEFAULT_SETTINGS = createDefaultSettings({ platform: 'win32' });

    // Verify agent commands use PowerShell syntax
    const claudeAgent: { readonly name: string; readonly command: string } | undefined = DEFAULT_SETTINGS.agents.find(
      (a: { readonly name: string; readonly command: string }) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('$env:AGENT_PROMPT');
    expect(claudeAgent!.command).not.toContain('"$AGENT_PROMPT"');

    // Verify all default agents use Windows syntax
    expect(DEFAULT_SETTINGS.agents.every(
      (agent: { readonly command: string }) => agent.command.includes('$env:AGENT_PROMPT')
    )).toBe(true);
  });

  it('should use $AGENT_PROMPT syntax on macOS', async () => {
    const DEFAULT_SETTINGS = createDefaultSettings({ platform: 'darwin' });

    // Verify agent commands use bash/zsh syntax
    const claudeAgent: { readonly name: string; readonly command: string } | undefined = DEFAULT_SETTINGS.agents.find(
      (a: { readonly name: string; readonly command: string }) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('"$AGENT_PROMPT"');
    expect(claudeAgent!.command).not.toContain('$env:');

    // Verify all default agents use Unix syntax
    expect(DEFAULT_SETTINGS.agents.every(
      (agent: { readonly command: string }) => !agent.command.includes('$env:')
    )).toBe(true);
  });

  it('should use $AGENT_PROMPT syntax on Linux', async () => {
    const DEFAULT_SETTINGS = createDefaultSettings({ platform: 'linux' });

    // Verify agent commands use bash syntax (same as macOS)
    const claudeAgent: { readonly name: string; readonly command: string } | undefined = DEFAULT_SETTINGS.agents.find(
      (a: { readonly name: string; readonly command: string }) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('"$AGENT_PROMPT"');
    expect(claudeAgent!.command).not.toContain('$env:');
  });
});
