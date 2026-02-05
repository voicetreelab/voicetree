import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { VTSettings } from '@/pure/settings/types';

import {DEFAULT_SETTINGS} from "@/pure/settings";

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<VTSettings> {
  const settingsPath: string = getSettingsPath();
  //console.log(`Loading Settings from Path: ${settingsPath}`);
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    const userSettings: Partial<VTSettings> = JSON.parse(data) as Partial<VTSettings>;
    // Merge: user settings override defaults, missing keys come from defaults
    return { ...DEFAULT_SETTINGS, ...userSettings };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

/**
 * Checks if AGENT_PROMPT differs from the current default.
 * If so, backs up the old value as AGENT_PROMPT_PREVIOUS_BACKUP and updates to the new default.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateAgentPromptIfNeeded(): Promise<boolean> {
  const settingsPath: string = getSettingsPath();

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    // No settings file or parse error - nothing to migrate
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const currentAgentPrompt: string | undefined = userSettings.INJECT_ENV_VARS?.AGENT_PROMPT as string | undefined;
  const defaultAgentPrompt: string = DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT as string;

  // No migration needed if:
  // - User has no AGENT_PROMPT set (will use default anyway)
  // - User's AGENT_PROMPT already matches the current default
  if (!currentAgentPrompt || currentAgentPrompt === defaultAgentPrompt) {
    return false;
  }

  // Migration needed: backup old value and update to new default
  const updatedSettings: VTSettings = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    INJECT_ENV_VARS: {
      ...userSettings.INJECT_ENV_VARS,
      AGENT_PROMPT: defaultAgentPrompt,
      AGENT_PROMPT_PREVIOUS_BACKUP: currentAgentPrompt,
    },
  };

  await saveSettings(updatedSettings);
  return true;
}

export async function saveSettings(settings: VTSettings): Promise<boolean> {
  const settingsPath: string = getSettingsPath();
  const settingsDir: string = path.dirname(settingsPath);

  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
}
