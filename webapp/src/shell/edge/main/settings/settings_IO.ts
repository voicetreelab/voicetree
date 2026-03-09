import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { VTSettings } from '@/pure/settings/types';

import {DEFAULT_SETTINGS} from "@/pure/settings";
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let settingsCache: VTSettings | null = null;
let settingsCacheTime: number = 0;
const SETTINGS_CACHE_TTL_MS: number = 5000;

export async function loadSettings(): Promise<VTSettings> {
  const now: number = Date.now();
  if (settingsCache && (now - settingsCacheTime) < SETTINGS_CACHE_TTL_MS) {
    return settingsCache;
  }
  const settingsPath: string = getSettingsPath();
  //console.log(`Loading Settings from Path: ${settingsPath}`);
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    const userSettings: Partial<VTSettings> = JSON.parse(data) as Partial<VTSettings>;
    // Merge: user settings override defaults, missing keys come from defaults
    settingsCache = { ...DEFAULT_SETTINGS, ...userSettings };
    settingsCacheTime = now;
    return settingsCache;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

/**
 * Ensures AGENT_PROMPT_CORE is up-to-date with the current default.
 * Unlike the old migrateAgentPromptIfNeeded, this NEVER overwrites AGENT_PROMPT —
 * only AGENT_PROMPT_CORE gets auto-updated, so user customizations to AGENT_PROMPT persist.
 *
 * On first migration (user has no AGENT_PROMPT_CORE yet):
 * - Adds AGENT_PROMPT_CORE with the current default
 * - If user's AGENT_PROMPT matches the old full-prompt default (now stored as AGENT_PROMPT_CORE content),
 *   updates it to '$AGENT_PROMPT_CORE' so it references the core
 *
 * On subsequent migrations:
 * - Only updates AGENT_PROMPT_CORE if it differs from the current default
 *
 * @returns true if migration occurred, false otherwise
 */
export async function migrateAgentPromptCoreIfNeeded(): Promise<boolean> {
  const settingsPath: string = getSettingsPath();

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const defaultCore: string = DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT_CORE as string;
  const currentCore: string | undefined = userSettings.INJECT_ENV_VARS?.AGENT_PROMPT_CORE as string | undefined;

  // First migration: user has no AGENT_PROMPT_CORE yet
  if (currentCore === undefined) {
    const currentAgentPrompt: string | undefined = userSettings.INJECT_ENV_VARS?.AGENT_PROMPT as string | undefined;

    // If user's AGENT_PROMPT matches the core content (old default), update it to reference $AGENT_PROMPT_CORE
    const shouldUpdateAgentPrompt: boolean = currentAgentPrompt !== undefined && currentAgentPrompt === defaultCore;

    const updatedSettings: VTSettings = {
      ...DEFAULT_SETTINGS,
      ...userSettings,
      INJECT_ENV_VARS: {
        ...userSettings.INJECT_ENV_VARS,
        AGENT_PROMPT_CORE: defaultCore,
        ...(shouldUpdateAgentPrompt ? { AGENT_PROMPT: '$AGENT_PROMPT_CORE' } : {}),
      },
    };

    await saveSettings(updatedSettings);
    return true;
  }

  // Subsequent migrations: only update AGENT_PROMPT_CORE if it differs
  if (currentCore === defaultCore) {
    return false;
  }

  const updatedSettings: VTSettings = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    INJECT_ENV_VARS: {
      ...userSettings.INJECT_ENV_VARS,
      AGENT_PROMPT_CORE: defaultCore,
    },
  };

  await saveSettings(updatedSettings);
  return true;
}

/**
 * Migrates layoutConfig JSON string to update nodeSpacing from old default (70) to new default (120).
 * Silent migration — no dialog, since users are unlikely to have intentionally set this value.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateLayoutConfigIfNeeded(): Promise<boolean> {
  const settingsPath: string = getSettingsPath();

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const layoutConfigStr: string | undefined = userSettings.layoutConfig;
  if (!layoutConfigStr) {
    return false; // No saved layoutConfig — will use new default anyway
  }

  try {
    const parsed: Record<string, unknown> = JSON.parse(layoutConfigStr) as Record<string, unknown>;
    if (parsed.nodeSpacing !== 70) {
      return false; // User has a custom value or already migrated
    }
    parsed.nodeSpacing = 120;
    const updatedSettings: VTSettings = {
      ...DEFAULT_SETTINGS,
      ...userSettings,
      layoutConfig: JSON.stringify(parsed, null, 2),
    };
    await saveSettings(updatedSettings);
    return true;
  } catch {
    return false; // Malformed JSON — leave as-is
  }
}

/**
 * Migrates starredFolders from old default (empty array) to new default
 * which includes ~/brain/workflows. Silent migration.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateStarredFoldersIfNeeded(): Promise<boolean> {
  const settingsPath: string = getSettingsPath();

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  // Only migrate if user has an explicit empty starredFolders array (old default)
  // If they have any entries, they've customized it — don't touch
  if (!Array.isArray(userSettings.starredFolders) || userSettings.starredFolders.length > 0) {
    return false;
  }

  const defaultStarred: readonly string[] | undefined = DEFAULT_SETTINGS.starredFolders;
  if (!defaultStarred || defaultStarred.length === 0) {
    return false; // No default to migrate to
  }

  const updatedSettings: VTSettings = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    starredFolders: [...defaultStarred],
  };

  await saveSettings(updatedSettings);
  return true;
}

/**
 * Migrates starredFolders entries from ~/voicetree/workflows to ~/brain/workflows.
 * Simple string replace on each entry. Silent migration.
 * @returns true if migration occurred, false otherwise
 */
export async function migrateStarredFoldersBrainRename(): Promise<boolean> {
  const settingsPath: string = getSettingsPath();

  let userSettings: Partial<VTSettings>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    userSettings = JSON.parse(data) as Partial<VTSettings>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  if (!Array.isArray(userSettings.starredFolders)) {
    return false;
  }

  const migrated: string[] = userSettings.starredFolders.map((entry: string) =>
    entry.replace('/voicetree/workflows', '/brain/workflows'),
  );

  const changed: boolean = migrated.some((entry: string, i: number) => entry !== userSettings.starredFolders![i]);
  if (!changed) {
    return false;
  }

  const updatedSettings: VTSettings = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    starredFolders: migrated,
  };

  await saveSettings(updatedSettings);
  return true;
}

export async function saveSettings(settings: VTSettings): Promise<boolean> {
  const settingsPath: string = getSettingsPath();
  const settingsDir: string = path.dirname(settingsPath);

  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  settingsCache = settings;
  settingsCacheTime = Date.now();
  uiAPI.onSettingsChanged();
  return true;
}
