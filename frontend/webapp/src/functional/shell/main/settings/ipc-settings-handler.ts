import { ipcMain } from 'electron';
import type { Settings } from '@/functional/pure/settings/types.ts';
import { loadSettings, saveSettings } from '@/functional/shell/main/settings/settings_IO.ts';
import { getCachedSettings, setCachedSettings } from '@/functional/shell/state/settings-cache.ts';

export function registerSettingsHandlers(): void {
  // Load settings
  ipcMain.handle('settings:load', async () => {
    const cachedSettings = getCachedSettings();
    if (cachedSettings) {
      return cachedSettings;
    }

    const settings = await loadSettings();
    setCachedSettings(settings);
    return settings;
  });

  // Save settings
  ipcMain.handle('settings:save', async (_event, settings: Settings) => {
    await saveSettings(settings);
    setCachedSettings(settings);
    return { success: true };
  });
}
