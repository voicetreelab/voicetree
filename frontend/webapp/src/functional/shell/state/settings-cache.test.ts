import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedSettings, setCachedSettings, clearCachedSettings } from './settings-cache';
import type { Settings } from '@/functional/pure/settings';

describe('settings-cache', () => {
  const mockSettings: Settings = {
    agentLaunchPath: '/test/path',
    agentCommand: 'test-command.sh'
  };

  const mockSettings2: Settings = {
    agentLaunchPath: '/another/path',
    agentCommand: 'another-command.sh'
  };

  // Reset cache before each test to ensure isolation
  beforeEach(() => {
    clearCachedSettings();
  });

  it('should return null initially', () => {
    const result = getCachedSettings();
    expect(result).toBeNull();
  });

  it('should store and retrieve settings', () => {
    setCachedSettings(mockSettings);
    const result = getCachedSettings();

    expect(result).toEqual(mockSettings);
  });

  it('should clear cached settings back to null', () => {
    setCachedSettings(mockSettings);
    expect(getCachedSettings()).toEqual(mockSettings);

    clearCachedSettings();
    expect(getCachedSettings()).toBeNull();
  });

  it('should return the same reference on multiple get calls (caching behavior)', () => {
    setCachedSettings(mockSettings);

    const result1 = getCachedSettings();
    const result2 = getCachedSettings();

    expect(result1).toBe(result2); // Same reference
  });

  it('should overwrite previous settings when called multiple times', () => {
    setCachedSettings(mockSettings);
    expect(getCachedSettings()).toEqual(mockSettings);

    setCachedSettings(mockSettings2);
    expect(getCachedSettings()).toEqual(mockSettings2);
  });
});
