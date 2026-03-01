import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { VTSettings } from '@/pure/settings/types';

import {DEFAULT_SETTINGS} from "@/pure/settings";
import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import { getKnownSettingKeys } from '@/shell/UI/views/components/settings/settingsRegistry';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Separates user settings into known and unknown keys.
 * Unknown keys are those not present in the settings registry.
 */
function separateUnknownKeys(userSettings: Record<string, unknown>): {
    known: Partial<VTSettings>;
    unknown: Record<string, unknown>;
} {
    const knownKeys: Set<string> = new Set(getKnownSettingKeys());
    const known: Record<string, unknown> = {};
    const unknown: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(userSettings)) {
        if (knownKeys.has(key)) {
            known[key] = value;
        } else {
            unknown[key] = value;
        }
    }

    return { known: known as Partial<VTSettings>, unknown };
}

/**
 * Merge strategy: Non-destructive preservation of user settings.
 *
 * 1. Known keys: user value overrides default (standard merge)
 * 2. Unknown keys: preserved from original user settings
 * 3. Result contains ALL original user keys plus any missing defaults
 *
 * This ensures forward compatibility - settings from future versions
 * are preserved when the app is downgraded.
 */
function mergeSettingsWithUnknowns(
    defaults: VTSettings,
    userSettings: Partial<VTSettings>,
    unknowns: Record<string, unknown>
): VTSettings {
    return {
        ...defaults,
        ...userSettings,
        ...unknowns,
    } as VTSettings;
}

export async function loadSettings(): Promise<VTSettings> {
  const settingsPath: string = getSettingsPath();

  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    const rawUserSettings: Record<string, unknown> = JSON.parse(data) as Record<string, unknown>;

    // Separate known and unknown keys
    const { known: userSettings, unknown: unknownKeys } = separateUnknownKeys(rawUserSettings);

    // Merge known settings with defaults
    const mergedKnown: VTSettings = { ...DEFAULT_SETTINGS, ...userSettings };

    // Re-attach unknown keys for non-destructive roundtrip
    return mergeSettingsWithUnknowns(DEFAULT_SETTINGS, userSettings, unknownKeys);
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

  let rawUserSettings: Record<string, unknown>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    rawUserSettings = JSON.parse(data) as Record<string, unknown>;
  } catch (error) {
    // No settings file or parse error - nothing to migrate
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const userSettings: Partial<VTSettings> = rawUserSettings as Partial<VTSettings>;
  const currentAgentPrompt: string | undefined = userSettings.INJECT_ENV_VARS?.AGENT_PROMPT as string | undefined;
  const defaultAgentPrompt: string = DEFAULT_SETTINGS.INJECT_ENV_VARS.AGENT_PROMPT as string;

  // No migration needed if:
  // - User has no AGENT_PROMPT set (will use default anyway)
  // - User's AGENT_PROMPT already matches the current default
  if (!currentAgentPrompt || currentAgentPrompt === defaultAgentPrompt) {
    return false;
  }

  // Migration needed: backup old value and update to new default
  const { known, unknown } = separateUnknownKeys(rawUserSettings);
  const updatedKnown: Partial<VTSettings> = {
    ...known,
    INJECT_ENV_VARS: {
      ...known.INJECT_ENV_VARS,
      AGENT_PROMPT: defaultAgentPrompt,
      AGENT_PROMPT_PREVIOUS_BACKUP: currentAgentPrompt,
    },
  };

  const updatedSettings: VTSettings = mergeSettingsWithUnknowns(DEFAULT_SETTINGS, updatedKnown, unknown);
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

  let rawUserSettings: Record<string, unknown>;
  try {
    const data: string = await fs.readFile(settingsPath, 'utf-8');
    rawUserSettings = JSON.parse(data) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const userSettings: Partial<VTSettings> = rawUserSettings as Partial<VTSettings>;
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

    const { known, unknown } = separateUnknownKeys(rawUserSettings);
    const updatedKnown: Partial<VTSettings> = {
      ...known,
      layoutConfig: JSON.stringify(parsed, null, 2),
    };

    const updatedSettings: VTSettings = mergeSettingsWithUnknowns(DEFAULT_SETTINGS, updatedKnown, unknown);
    await saveSettings(updatedSettings);
    return true;
  } catch {
    return false; // Malformed JSON — leave as-is
  }
}

export async function saveSettings(settings: VTSettings): Promise<boolean> {
  const settingsPath: string = getSettingsPath();
  const settingsDir: string = path.dirname(settingsPath);

  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  uiAPI.onSettingsChanged();
  return true;
}
