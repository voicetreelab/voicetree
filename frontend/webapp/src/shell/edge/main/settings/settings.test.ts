import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadSettings, saveSettings } from './settings_IO.ts';
import type { Settings } from '@/pure/settings/types.ts';
import { DEFAULT_SETTINGS } from '@/pure/settings/types.ts';

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
    const settings = await loadSettings();

    expect(settings).toEqual(DEFAULT_SETTINGS);

    const settingsPath = path.join(testUserDataPath, 'settings.json');
    const fileExists = await fs.access(settingsPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);

    const fileContent = await fs.readFile(settingsPath, 'utf-8');
    expect(JSON.parse(fileContent)).toEqual(DEFAULT_SETTINGS);
  });

  it('should return saved settings on subsequent calls', async () => {
    const firstLoad = await loadSettings();
    expect(firstLoad).toEqual(DEFAULT_SETTINGS);

    const customSettings: Settings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/custom/path',
      agentCommand: 'custom-command.sh',
      shiftEnterSendsOptionEnter: false
    };

    await saveSettings(customSettings);

    const secondLoad = await loadSettings();
    expect(secondLoad).toEqual(customSettings);
  });

  it('should persist data correctly', async () => {
    const customSettings: Settings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/test/path',
      agentCommand: 'test.sh',
      shiftEnterSendsOptionEnter: true
    };

    await saveSettings(customSettings);

    const settingsPath = path.join(testUserDataPath, 'settings.json');
    const fileContent = await fs.readFile(settingsPath, 'utf-8');

    expect(JSON.parse(fileContent)).toEqual(customSettings);
  });

  it('should create parent directory if needed', async () => {
    await fs.rm(testUserDataPath, { recursive: true, force: true });

    const settings: Settings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/another/path',
      agentCommand: 'another.sh',
      shiftEnterSendsOptionEnter: true
    };

    await saveSettings(settings);

    const settingsPath = path.join(testUserDataPath, 'settings.json');
    const fileExists = await fs.access(settingsPath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should throw on corrupted settings file', async () => {
    const settingsPath = path.join(testUserDataPath, 'settings.json');
    await fs.writeFile(settingsPath, 'not valid json{');

    await expect(loadSettings()).rejects.toThrow();
  });
});
