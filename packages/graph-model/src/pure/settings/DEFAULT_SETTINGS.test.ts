import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('DEFAULT_SETTINGS platform-specific env var syntax', () => {
  const originalPlatform: NodeJS.Platform = process.platform;

  beforeEach(() => {
    // Clear module cache to allow re-importing with different platform
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    });
  });

  it('should use $env:AGENT_PROMPT syntax on Windows', async () => {
    // Mock process.platform as Windows
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });

    // Dynamically import to get fresh module with mocked platform
    const { DEFAULT_SETTINGS } = await import('./DEFAULT_SETTINGS');

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
    // Mock process.platform as macOS
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Dynamically import to get fresh module with mocked platform
    const { DEFAULT_SETTINGS } = await import('./DEFAULT_SETTINGS');

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
    // Mock process.platform as Linux
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      writable: true,
      configurable: true,
    });

    // Dynamically import to get fresh module with mocked platform
    const { DEFAULT_SETTINGS } = await import('./DEFAULT_SETTINGS');

    // Verify agent commands use bash syntax (same as macOS)
    const claudeAgent: { readonly name: string; readonly command: string } | undefined = DEFAULT_SETTINGS.agents.find(
      (a: { readonly name: string; readonly command: string }) => a.name === 'Claude'
    );
    expect(claudeAgent).toBeDefined();
    expect(claudeAgent!.command).toContain('"$AGENT_PROMPT"');
    expect(claudeAgent!.command).not.toContain('$env:');
  });
});
