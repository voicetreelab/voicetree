import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSettings, saveSettings, clearSettingsCache } from './settings_IO';
import type { VTSettings } from '@/pure/settings/types';

import {DEFAULT_SETTINGS} from "@/pure/settings";

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testUserDataPath)
  }
}));

let testUserDataPath: string;

describe('settings', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
    clearSettingsCache();
  });

  afterEach(async () => {
    await fs.rm(testUserDataPath, { recursive: true, force: true });
  });

  it('should create file with defaults on first run', async () => {
    const settings: VTSettings = await loadSettings();

    expect(settings).toEqual(DEFAULT_SETTINGS);

    const settingsPath: string = path.join(testUserDataPath, 'settings.json');
    const fileExists: boolean = await fs.access(settingsPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);

    const fileContent: string = await fs.readFile(settingsPath, 'utf-8');
    expect(JSON.parse(fileContent)).toEqual(DEFAULT_SETTINGS);
  });

  it('should return saved settings on subsequent calls', async () => {
    const custom: VTSettings = { ...DEFAULT_SETTINGS, darkMode: true, vimMode: true };
    await saveSettings(custom);
    expect(await loadSettings()).toEqual(custom);
  });

  it('should persist data correctly', async () => {
    const customSettings: VTSettings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/test/path',
      INJECT_ENV_VARS: { TEST_VAR: 'test_value' },
      agents: [{ name: 'Test Agent', command: 'test.sh' }],
      shiftEnterSendsOptionEnter: true,
      contextNodeMaxDistance: 7,
      contextMaxChars: 8000,
      askModeContextDistance: 4
    };

    await saveSettings(customSettings);

    const settingsPath: string = path.join(testUserDataPath, 'settings.json');
    const fileContent: string = await fs.readFile(settingsPath, 'utf-8');

    expect(JSON.parse(fileContent)).toEqual(customSettings);
  });

  it('should create parent directory if needed', async () => {
    await fs.rm(testUserDataPath, { recursive: true, force: true });

    const settings: VTSettings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/another/path',
      INJECT_ENV_VARS: { ANOTHER_VAR: 'another_value' },
      agents: [{ name: 'Another Agent', command: 'another.sh' }],
      shiftEnterSendsOptionEnter: true,
      contextNodeMaxDistance: 7,
      contextMaxChars: 8000,
      askModeContextDistance: 4
    };

    await saveSettings(settings);

    const settingsPath: string = path.join(testUserDataPath, 'settings.json');
    const fileExists: boolean = await fs.access(settingsPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should throw on corrupted settings file', async () => {
    const settingsPath: string = path.join(testUserDataPath, 'settings.json');
    await fs.writeFile(settingsPath, 'not valid json{');

    await expect(loadSettings()).rejects.toThrow();
  });

  describe('INJECT_ENV_VARS deep-merge', () => {
    it('no INJECT_ENV_VARS in file → all default keys present (AGENT_PROMPT, AGENT_PROMPT_CORE, AGENT_PROMPT_LIGHTWEIGHT)', async () => {
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        agents: [{ name: 'Test', command: 'test "$AGENT_PROMPT"' }],
        terminalSpawnPathRelativeToWatchedDirectory: '/'
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT).toBe('$AGENT_PROMPT_CORE');
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).toBeTruthy();
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_LIGHTWEIGHT).toBeTruthy();
    });

    it('file has only AGENT_PROMPT_CORE (post-migration state) → AGENT_PROMPT and AGENT_PROMPT_LIGHTWEIGHT filled from defaults', async () => {
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        INJECT_ENV_VARS: { AGENT_PROMPT_CORE: 'old core content' }
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT).toBe('$AGENT_PROMPT_CORE');
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_LIGHTWEIGHT).toBeTruthy();
    });

    it('user custom AGENT_PROMPT is preserved in deep-merge', async () => {
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        INJECT_ENV_VARS: { AGENT_PROMPT: 'Always use bun. $AGENT_PROMPT_CORE' }
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT).toBe('Always use bun. $AGENT_PROMPT_CORE');
      // Other keys still come from defaults
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).toBeTruthy();
    });

    it('AGENT_PROMPT_CORE is always the current default, not the stale file value', async () => {
      const staleCore: string = 'This is an old outdated core from 2024';
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        INJECT_ENV_VARS: { AGENT_PROMPT_CORE: staleCore }
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).toBe(DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT_CORE);
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).not.toBe(staleCore);
    });
  });
});
