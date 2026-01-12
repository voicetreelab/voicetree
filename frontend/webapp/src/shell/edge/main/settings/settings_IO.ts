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
  console.log(`Loading Settings from Path: ${settingsPath}`);
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

export async function saveSettings(settings: VTSettings): Promise<boolean> {
  const settingsPath: string = getSettingsPath();
  const settingsDir: string = path.dirname(settingsPath);

  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
}
