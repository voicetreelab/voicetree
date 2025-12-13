import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedSettings, setCachedSettings, clearCachedSettings } from './settings-cache';
import type { VTSettings } from '@/pure/settings';

describe('settings-cache', () => {
  beforeEach(() => {
    clearCachedSettings();
  });

  it('cache roundtrip smoke test', () => {
    const mockSettings: VTSettings = {
      terminalSpawnPathRelativeToWatchedDirectory: '/test/path',
      agents: [{ name: 'Test Agent', command: 'test-command.sh' }],
      shiftEnterSendsOptionEnter: true,
      INJECT_ENV_VARS: {},
      contextNodeMaxDistance: 7,
      askModeContextDistance: 4,
      defaultInputMode: 'add'
    };
    setCachedSettings(mockSettings);
    expect(getCachedSettings()).toEqual(mockSettings);
  });
});
