import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedSettings, setCachedSettings, clearCachedSettings } from './settings-cache';
import type { VTSettings } from '@/pure/settings';

describe('settings-cache', () => {
  beforeEach(() => {
    clearCachedSettings();
  });

  it('should start null, accept settings, and clear back to null', () => {
    // Initial state is null
    expect(getCachedSettings()).toBeNull();

    // Can set settings
    const mockSettings: VTSettings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/test/path',
      agents: [{ name: 'Test Agent', command: 'test-command.sh' }],
      shiftEnterSendsOptionEnter: true
    };
    setCachedSettings(mockSettings);
    expect(getCachedSettings()).toEqual(mockSettings);

    // Can clear settings back to null
    clearCachedSettings();
    expect(getCachedSettings()).toBeNull();
  });
});
