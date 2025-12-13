import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSettings, saveSettings } from './settings_IO';
import type { VTSettings } from '@/pure/settings/types';
import { DEFAULT_SETTINGS } from '@/pure/settings/types';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testUserDataPath)
  }
}));

let testUserDataPath: string;

describe('settings', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
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
    const firstLoad: VTSettings = await loadSettings();
    expect(firstLoad).toEqual(DEFAULT_SETTINGS);

    const customSettings: VTSettings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/custom/path',
      INJECT_ENV_VARS: { CUSTOM_VAR: 'custom_value' },
      agents: [{ name: 'Custom Agent', command: 'custom-command.sh' }],
      shiftEnterSendsOptionEnter: false,
      contextNodeMaxDistance: 7,
      askModeContextDistance: 4,
      defaultInputMode: 'add'
    };

    await saveSettings(customSettings);

    const secondLoad: VTSettings = await loadSettings();
    expect(secondLoad).toEqual(customSettings);
  });

  it('should persist data correctly', async () => {
    const customSettings: VTSettings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/test/path',
      INJECT_ENV_VARS: { TEST_VAR: 'test_value' },
      agents: [{ name: 'Test Agent', command: 'test.sh' }],
      shiftEnterSendsOptionEnter: true,
      contextNodeMaxDistance: 7,
      askModeContextDistance: 4,
      defaultInputMode: 'add'
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
      askModeContextDistance: 4,
      defaultInputMode: 'add'
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
});
