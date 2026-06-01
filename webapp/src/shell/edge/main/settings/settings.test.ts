import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSettings, saveSettings, clearSettingsCache } from './settings_IO';
import type { VTSettings } from '@vt/graph-model/settings';

import {DEFAULT_SETTINGS} from "@vt/graph-model/settings";

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testUserDataPath)
  }
}));

let testUserDataPath: string;
let originalEnv: string | undefined;

describe('settings', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
    originalEnv = process.env.VOICETREE_HOME_PATH;
    process.env.VOICETREE_HOME_PATH = testUserDataPath;
    clearSettingsCache();
  });

  afterEach(async () => {
    await fs.rm(testUserDataPath, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.VOICETREE_HOME_PATH;
    } else {
      process.env.VOICETREE_HOME_PATH = originalEnv;
    }
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

  it('observes settings.json changes written outside this process immediately', async () => {
    const initial: VTSettings = {
      ...DEFAULT_SETTINGS,
      agents: [{ name: 'Initial Agent', command: 'initial "$AGENT_PROMPT"' }],
    };
    const externallyUpdated: VTSettings = {
      ...DEFAULT_SETTINGS,
      agents: [{ name: 'Updated Agent', command: 'updated "$AGENT_PROMPT"' }],
    };
    const settingsPath: string = path.join(testUserDataPath, 'settings.json');

    await saveSettings(initial);
    await fs.writeFile(settingsPath, JSON.stringify(externallyUpdated, null, 2), 'utf-8');

    expect(await loadSettings()).toEqual(externallyUpdated);
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
    it('no INJECT_ENV_VARS in file → default keys present (AGENT_PROMPT, DEPTH_BUDGET); prompt bodies are not settings', async () => {
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        agents: [{ name: 'Test', command: 'test "$AGENT_PROMPT"' }],
        terminalSpawnPathRelativeToWatchedDirectory: '/'
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      // AGENT_PROMPT_CORE / AGENT_PROMPT_LIGHTWEIGHT now live as .md files resolved at
      // spawn from the project's prompts dir — they are no longer settings defaults.
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT).toBe('$AGENT_PROMPT_CORE');
      expect(settings.INJECT_ENV_VARS.DEPTH_BUDGET).toBeTruthy();
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).toBeUndefined();
      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_LIGHTWEIGHT).toBeUndefined();
    });

    it('user custom AGENT_PROMPT is preserved while other defaults remain', async () => {
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        INJECT_ENV_VARS: { AGENT_PROMPT: 'Always use bun. $AGENT_PROMPT_CORE' }
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT).toBe('Always use bun. $AGENT_PROMPT_CORE');
      // Other default keys still come through the deep-merge.
      expect(settings.INJECT_ENV_VARS.DEPTH_BUDGET).toBeTruthy();
    });

    it('a user AGENT_PROMPT_CORE override in settings is preserved through the deep-merge', async () => {
      const customCore: string = 'This is a custom prompt core override';
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        INJECT_ENV_VARS: { AGENT_PROMPT_CORE: customCore }
      }), 'utf-8');

      const settings: VTSettings = await loadSettings();

      expect(settings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).toBe(customCore);
    });

    it('a user AGENT_PROMPT_CORE override survives an unrelated settings save', async () => {
      const customCore: string = 'Persist me across later saves';
      const settingsPath: string = path.join(testUserDataPath, 'settings.json');
      await fs.writeFile(settingsPath, JSON.stringify({
        darkMode: false,
        INJECT_ENV_VARS: { AGENT_PROMPT_CORE: customCore }
      }), 'utf-8');

      const loadedSettings: VTSettings = await loadSettings();
      await saveSettings({ ...loadedSettings, darkMode: true });

      clearSettingsCache();
      const reloadedSettings: VTSettings = await loadSettings();

      expect(reloadedSettings.darkMode).toBe(true);
      expect(reloadedSettings.INJECT_ENV_VARS.AGENT_PROMPT_CORE).toBe(customCore);
    });
  });
});
