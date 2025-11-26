import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import type { VTSettings } from '@/pure/settings/types.ts';
import { DEFAULT_SETTINGS  } from '@/pure/settings/types.ts';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<VTSettings> {
  const settingsPath = getSettingsPath();
  console.log(`Loading Settings from Path: ${settingsPath}`);
  try {
    const data = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(data) as VTSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

export async function saveSettings(settings: VTSettings): Promise<boolean> {
  const settingsPath = getSettingsPath();
  const settingsDir = path.dirname(settingsPath);

  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  return true;
}
