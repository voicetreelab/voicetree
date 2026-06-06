import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {DEFAULT_SETTINGS} from '@vt/graph-model/settings';
import type {VTSettings} from '@vt/graph-model/settings';
import {VOICETREE_HOME_PATH_ENV} from '@vt/paths';
import {SETTINGS_FILENAME} from '../config-files.ts';
import {loadSettings, saveSettings} from './settings_IO.ts';

let homeDir: string;
let originalEnv: string | undefined;

async function readSettingsFromDisk(): Promise<VTSettings> {
  const raw: string = await fs.readFile(path.join(homeDir, SETTINGS_FILENAME), 'utf-8');
  return JSON.parse(raw) as VTSettings;
}

describe('settings IO prompt env sanitization', () => {
  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-settings-io-'));
    originalEnv = process.env[VOICETREE_HOME_PATH_ENV];
    process.env[VOICETREE_HOME_PATH_ENV] = homeDir;
  });

  afterEach(async () => {
    await fs.rm(homeDir, {recursive: true, force: true});
    if (originalEnv === undefined) delete process.env[VOICETREE_HOME_PATH_ENV];
    else process.env[VOICETREE_HOME_PATH_ENV] = originalEnv;
  });

  it('prunes stale file-backed prompt env keys when loading existing settings', async () => {
    await fs.mkdir(homeDir, {recursive: true});
    await fs.writeFile(path.join(homeDir, SETTINGS_FILENAME), JSON.stringify({
      ...DEFAULT_SETTINGS,
      INJECT_ENV_VARS: {
        AGENT_PROMPT: '$AGENT_PROMPT_CORE',
        AGENT_PROMPT_CORE: 'stale core body',
        AGENT_PROMPT_LIGHTWEIGHT: 'stale lightweight body',
        AGENT_PROMPT_FILE: '/tmp/stale-prompt-file',
        CUSTOM_CONTEXT: 'keep me',
      },
    }, null, 2), 'utf-8');

    const loaded: VTSettings = await loadSettings();
    const onDisk: VTSettings = await readSettingsFromDisk();

    expect(loaded.INJECT_ENV_VARS).toEqual({
      AGENT_PROMPT: '$AGENT_PROMPT_CORE',
      DEPTH_BUDGET: '12',
      CUSTOM_CONTEXT: 'keep me',
    });
    expect(onDisk.INJECT_ENV_VARS).toEqual(loaded.INJECT_ENV_VARS);
  });

  it('prunes reserved AGENT_PROMPT_* env keys before saving settings', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      INJECT_ENV_VARS: {
        AGENT_PROMPT: '$AGENT_PROMPT_CORE',
        AGENT_PROMPT_CORE: 'stale core body',
        AGENT_PROMPT_LIGHTWEIGHT: 'stale lightweight body',
        CUSTOM_CONTEXT: 'keep me',
      },
    });

    expect((await readSettingsFromDisk()).INJECT_ENV_VARS).toEqual({
      AGENT_PROMPT: '$AGENT_PROMPT_CORE',
      CUSTOM_CONTEXT: 'keep me',
    });
  });
});
