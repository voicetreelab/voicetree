/**
 * Unit tests for ipc-settings-handler.ts
 * Tests that settings IPC handlers are registered correctly and invoke the right functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Settings } from '@/functional/pure/settings/types.ts';
import { DEFAULT_SETTINGS } from '@/functional/pure/settings/types.ts';

// Mock modules
const mockLoadSettings = vi.fn();
const mockSaveSettings = vi.fn();
const mockGetCachedSettings = vi.fn();
const mockSetCachedSettings = vi.fn();
const mockIpcMainHandle = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}));

vi.mock('@/functional/shell/main/settings/settings_IO.ts', () => ({
  loadSettings: mockLoadSettings,
  saveSettings: mockSaveSettings,
}));

vi.mock('@/functional/shell/state/settings-cache.ts', () => ({
  getCachedSettings: mockGetCachedSettings,
  setCachedSettings: mockSetCachedSettings,
}));

describe('registerSettingsHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register settings:load handler', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    registerSettingsHandlers();

    // Verify that ipcMain.handle was called for settings:load
    expect(mockIpcMainHandle).toHaveBeenCalledWith('settings:load', expect.any(Function));
  });

  it('should register settings:save handler', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    registerSettingsHandlers();

    // Verify that ipcMain.handle was called for settings:save
    expect(mockIpcMainHandle).toHaveBeenCalledWith('settings:save', expect.any(Function));
  });

  it('should return cached settings when available', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    const mockSettings: Settings = {
      agentLaunchPath: '/cached/path',
      agentCommand: './cached.sh',
    };

    mockGetCachedSettings.mockReturnValueOnce(mockSettings);

    registerSettingsHandlers();

    // Get the handler function for settings:load
    const loadHandlerCall = mockIpcMainHandle.mock.calls.find(
      call => call[0] === 'settings:load'
    );
    expect(loadHandlerCall).toBeDefined();
    const loadHandler = loadHandlerCall?.[1];

    // Call the handler
    const result = await loadHandler();

    // Verify cache was checked
    expect(mockGetCachedSettings).toHaveBeenCalled();

    // Verify loadSettings was NOT called (cache hit)
    expect(mockLoadSettings).not.toHaveBeenCalled();

    // Verify correct cached settings were returned
    expect(result).toEqual(mockSettings);
  });

  it('should load settings from disk when cache is empty', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    const mockSettings: Settings = {
      agentLaunchPath: '/test/path',
      agentCommand: './test.sh',
    };

    mockGetCachedSettings.mockReturnValueOnce(null);
    mockLoadSettings.mockResolvedValueOnce(mockSettings);

    registerSettingsHandlers();

    // Get the handler function for settings:load
    const loadHandlerCall = mockIpcMainHandle.mock.calls.find(
      call => call[0] === 'settings:load'
    );
    expect(loadHandlerCall).toBeDefined();
    const loadHandler = loadHandlerCall?.[1];

    // Call the handler
    const result = await loadHandler();

    // Verify cache was checked first
    expect(mockGetCachedSettings).toHaveBeenCalled();

    // Verify loadSettings was called (cache miss)
    expect(mockLoadSettings).toHaveBeenCalled();

    // Verify cache was updated
    expect(mockSetCachedSettings).toHaveBeenCalledWith(mockSettings);

    // Verify correct settings were returned
    expect(result).toEqual(mockSettings);
  });

  it('should save settings and update cache when settings:save is called', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    const testSettings: Settings = {
      agentLaunchPath: '/custom/path',
      agentCommand: './custom.sh',
    };

    mockSaveSettings.mockResolvedValueOnce(undefined);

    registerSettingsHandlers();

    // Get the handler function for settings:save
    const saveHandlerCall = mockIpcMainHandle.mock.calls.find(
      call => call[0] === 'settings:save'
    );
    expect(saveHandlerCall).toBeDefined();
    const saveHandler = saveHandlerCall?.[1];

    // Call the handler with test settings
    const result = await saveHandler({}, testSettings);

    // Verify saveSettings was called with correct settings
    expect(mockSaveSettings).toHaveBeenCalledWith(testSettings);

    // Verify cache was updated
    expect(mockSetCachedSettings).toHaveBeenCalledWith(testSettings);

    // Verify success response
    expect(result).toEqual({ success: true });
  });

  it('should handle default settings', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    mockGetCachedSettings.mockReturnValueOnce(null);
    mockLoadSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);

    registerSettingsHandlers();

    const loadHandlerCall = mockIpcMainHandle.mock.calls.find(
      call => call[0] === 'settings:load'
    );
    const loadHandler = loadHandlerCall?.[1];

    const result = await loadHandler();

    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(mockSetCachedSettings).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('should propagate errors from loadSettings', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    const testError = new Error('Failed to load settings');

    mockGetCachedSettings.mockReturnValueOnce(null);
    mockLoadSettings.mockRejectedValueOnce(testError);

    registerSettingsHandlers();

    const loadHandlerCall = mockIpcMainHandle.mock.calls.find(
      call => call[0] === 'settings:load'
    );
    const loadHandler = loadHandlerCall?.[1];

    await expect(loadHandler()).rejects.toThrow('Failed to load settings');
  });

  it('should propagate errors from saveSettings', async () => {
    const { registerSettingsHandlers } = await import('./ipc-settings-handler.ts');

    const testError = new Error('Failed to save settings');
    const testSettings: Settings = {
      agentLaunchPath: '/error/path',
      agentCommand: './error.sh',
    };

    mockSaveSettings.mockRejectedValueOnce(testError);

    registerSettingsHandlers();

    const saveHandlerCall = mockIpcMainHandle.mock.calls.find(
      call => call[0] === 'settings:save'
    );
    const saveHandler = saveHandlerCall?.[1];

    await expect(saveHandler({}, testSettings)).rejects.toThrow('Failed to save settings');
  });
});
