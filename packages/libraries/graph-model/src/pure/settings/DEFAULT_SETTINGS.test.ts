import { describe, it, expect } from 'vitest';
import { createDefaultSettings } from './settingsSchema';
import type { AgentConfig } from './types';

describe('DEFAULT_SETTINGS platform-specific env var syntax', () => {
  it('should use $env:AGENT_PROMPT syntax on Windows', async () => {
    const DEFAULT_SETTINGS = createDefaultSettings({ platform: 'win32' });

    // Verify agent commands use PowerShell syntax
    const claudeAgent: AgentConfig | undefined = DEFAULT_SETTINGS.agents.find(
      (a: AgentConfig) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('$env:AGENT_PROMPT');
    expect(claudeAgent!.command).not.toContain('"$AGENT_PROMPT"');

    // Verify all default agents use Windows syntax
    expect(DEFAULT_SETTINGS.agents.every(
      (agent: AgentConfig) => agent.command?.includes('$env:AGENT_PROMPT') ?? false
    )).toBe(true);
  });

  it('should use $AGENT_PROMPT syntax on macOS', async () => {
    const DEFAULT_SETTINGS = createDefaultSettings({ platform: 'darwin' });

    // Verify agent commands use bash/zsh syntax
    const claudeAgent: AgentConfig | undefined = DEFAULT_SETTINGS.agents.find(
      (a: AgentConfig) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('"$AGENT_PROMPT"');
    expect(claudeAgent!.command).not.toContain('$env:');

    // Verify all default agents use Unix syntax
    expect(DEFAULT_SETTINGS.agents.every(
      (agent: AgentConfig) => !(agent.command?.includes('$env:') ?? false)
    )).toBe(true);
  });

  it('should use $AGENT_PROMPT syntax on Linux', async () => {
    const DEFAULT_SETTINGS = createDefaultSettings({ platform: 'linux' });

    // Verify agent commands use bash syntax (same as macOS)
    const claudeAgent: AgentConfig | undefined = DEFAULT_SETTINGS.agents.find(
      (a: AgentConfig) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('"$AGENT_PROMPT"');
    expect(claudeAgent!.command).not.toContain('$env:');
  });
});
