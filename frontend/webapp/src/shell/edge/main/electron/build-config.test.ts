/**
 * Unit e2e-tests for centralized build configuration
 * Tests that build-config correctly computes paths for dev/prod/packaged modes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock electron app module (hoisted to avoid initialization issues)
const { mockApp } = vi.hoisted(() => {
  return {
    mockApp: {
      isPackaged: false,
      getAppPath: vi.fn(),
      getPath: vi.fn(),
    }
  };
});

vi.mock('electron', () => ({
  app: mockApp,
}));

// Import after mocking
import { getBuildConfig } from '@/shell/edge/main/electron/build-config.ts';

describe('build-config', () => {
  const mockUserDataPath = '/Users/test/Library/Application Support/Electron';
  const mockAppPath = '/Users/test/repos/VoiceTree/frontend/webapp';
  const repoRoot = path.resolve(mockAppPath, '../..');

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.isPackaged = false;
    mockApp.getAppPath.mockReturnValue(mockAppPath);
    mockApp.getPath.mockReturnValue(mockUserDataPath);

    // Reset environment
    delete process.env.NODE_ENV;
    delete process.env.HEADLESS_TEST;
  });

  describe('getBuildConfig - Development Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should use repo source for tools in development', () => {
      const config = getBuildConfig();

      expect(config.toolsSource).toBe(path.join(repoRoot, 'tools'));
      expect(config.backendSource).toBe(path.join(repoRoot, 'backend'));
    });

    it('should use Application Support for destination', () => {
      const config = getBuildConfig();

      expect(config.toolsDest).toBe(path.join(mockUserDataPath, 'tools'));
      expect(config.backendDest).toBe(path.join(mockUserDataPath, 'backend'));
    });

    it('should configure Python to run directly from source', () => {
      const config = getBuildConfig();

      expect(config.pythonCommand).toBe('python');
      expect(config.pythonArgs).toEqual(['server.py']);
      expect(config.shouldCompilePython).toBe(false);
      expect(config.serverBinaryPath).toBeNull();
    });

    it('should enable tool copying in development', () => {
      const config = getBuildConfig();

      expect(config.shouldCopyTools).toBe(true);
    });
  });

  describe('getBuildConfig - Production Mode (Unpackaged)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      mockApp.isPackaged = false;
    });

    it('should use repo for tools in production build', () => {
      const config = getBuildConfig();

      // In production but not packaged, still uses repo
      expect(config.toolsSource).toBe(path.join(repoRoot, 'tools'));
      expect(config.backendSource).toBe(path.join(repoRoot, 'backend'));
    });

    it('should configure compiled Python binary', () => {
      const config = getBuildConfig();

      const expectedBinaryPath = path.join(repoRoot, 'dist', 'resources', 'server', 'voicetree-server');
      expect(config.pythonCommand).toBe(expectedBinaryPath);
      expect(config.pythonArgs).toEqual([]);
      expect(config.pythonCwd).toBe(repoRoot);
      expect(config.shouldCompilePython).toBe(true);
      expect(config.serverBinaryPath).toBe(expectedBinaryPath);
    });
  });

  describe('getBuildConfig - Production Mode (Packaged)', () => {
    const mockResourcesPath = '/Applications/VoiceTree.app/Contents/Resources';

    beforeEach(() => {
      mockApp.isPackaged = true;
      process.env.NODE_ENV = 'production';
      // Mock process.resourcesPath
      Object.defineProperty(process, 'resourcesPath', {
        value: mockResourcesPath,
        writable: true,
        configurable: true
      });
    });

    it('should use process.resourcesPath for tools in packaged app', () => {
      const config = getBuildConfig();

      expect(config.toolsSource).toBe(path.join(mockResourcesPath, 'tools'));
      expect(config.backendSource).toBe(path.join(mockResourcesPath, 'backend'));
    });

    it('should use process.resourcesPath for server binary', () => {
      const config = getBuildConfig();

      const expectedBinaryPath = path.join(mockResourcesPath, 'server', 'voicetree-server');
      expect(config.serverBinaryPath).toBe(expectedBinaryPath);
      expect(config.pythonCommand).toBe(expectedBinaryPath);
    });
  });

  describe('getBuildConfig - Test Mode', () => {
    it('should skip tool copying in test mode', () => {
      process.env.HEADLESS_TEST = '1';

      const config = getBuildConfig();

      expect(config.shouldCopyTools).toBe(false);
    });
  });

  describe('Path Consistency', () => {
    it('should maintain same destination paths across all modes', () => {
      process.env.NODE_ENV = 'development';
      const devConfig = getBuildConfig();

      process.env.NODE_ENV = 'production';
      const prodConfig = getBuildConfig();

      // Destinations should be same regardless of mode
      expect(devConfig.toolsDest).toBe(prodConfig.toolsDest);
      expect(devConfig.backendDest).toBe(prodConfig.backendDest);
    });

    it('should change source paths based on packaging', () => {
      const mockResourcesPath = '/Applications/VoiceTree.app/Contents/Resources';

      // Unpackaged
      mockApp.isPackaged = false;
      const unpackagedConfig = getBuildConfig();

      // Packaged
      mockApp.isPackaged = true;
      Object.defineProperty(process, 'resourcesPath', {
        value: mockResourcesPath,
        writable: true,
        configurable: true
      });
      const packagedConfig = getBuildConfig();

      // Source should differ
      expect(unpackagedConfig.toolsSource).not.toBe(packagedConfig.toolsSource);
      expect(unpackagedConfig.backendSource).not.toBe(packagedConfig.backendSource);
    });
  });

  describe('Edge Cases', () => {
    it('should default to production if NODE_ENV not set', () => {
      delete process.env.NODE_ENV;
      const config = getBuildConfig();

      // Should use production config (has serverBinaryPath)
      expect(config.serverBinaryPath).not.toBeNull();
      expect(config.shouldCompilePython).toBe(true);
    });

    it('should handle missing environment variables gracefully', () => {
      delete process.env.NODE_ENV;
      delete process.env.HEADLESS_TEST;

      expect(() => getBuildConfig()).not.toThrow();
    });
  });
});
