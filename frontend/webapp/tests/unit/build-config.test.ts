/**
 * Unit tests for centralized build configuration
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
import { createBuildEnv, getBuildConfig, type BuildEnv } from '../../src/electron/build-config';

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

  describe('createBuildEnv', () => {
    it('should detect development environment', () => {
      process.env.NODE_ENV = 'development';

      const env = createBuildEnv();

      expect(env.nodeEnv).toBe('development');
      expect(env.isPackaged).toBe(false);
      expect(env.isTest).toBe(false);
      expect(env.appPath).toBe(mockAppPath);
      expect(env.userDataPath).toBe(mockUserDataPath);
    });

    it('should detect test environment', () => {
      process.env.HEADLESS_TEST = '1';

      const env = createBuildEnv();

      expect(env.isTest).toBe(true);
    });

    it('should compute repo root correctly in dev mode', () => {
      const env = createBuildEnv();

      expect(env.rootDir).toBe(repoRoot);
    });

    it('should use process.resourcesPath for packaged app', () => {
      mockApp.isPackaged = true;
      process.resourcesPath = '/Applications/VoiceTree.app/Contents/Resources';

      const env = createBuildEnv();

      expect(env.isPackaged).toBe(true);
      expect(env.rootDir).toBe('/Applications/VoiceTree.app/Contents');
    });
  });

  describe('getBuildConfig - Development Mode', () => {
    it('should use repo source for tools in development', () => {
      process.env.NODE_ENV = 'development';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      expect(config.toolsSource).toBe(path.join(repoRoot, 'tools'));
      expect(config.backendSource).toBe(path.join(repoRoot, 'backend'));
    });

    it('should use Application Support for destination', () => {
      process.env.NODE_ENV = 'development';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      expect(config.toolsDest).toBe(path.join(mockUserDataPath, 'tools'));
      expect(config.backendDest).toBe(path.join(mockUserDataPath, 'backend'));
    });

    it('should configure Python to run directly from source', () => {
      process.env.NODE_ENV = 'development';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      expect(config.pythonCommand).toBe('python');
      expect(config.pythonArgs).toEqual(['server.py']);
      expect(config.pythonCwd).toBe(path.join(repoRoot, 'backend'));
      expect(config.shouldCompilePython).toBe(false);
      expect(config.serverBinaryPath).toBeNull();
    });

    it('should enable tool copying in development', () => {
      process.env.NODE_ENV = 'development';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      expect(config.shouldCopyTools).toBe(true);
    });
  });

  describe('getBuildConfig - Production Mode (Unpackaged)', () => {
    it('should use dist/resources for tools in production build', () => {
      process.env.NODE_ENV = 'production';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      // In production but not packaged, still uses repo
      expect(config.toolsSource).toBe(path.join(repoRoot, 'tools'));
      expect(config.backendSource).toBe(path.join(repoRoot, 'backend'));
    });

    it('should configure compiled Python binary', () => {
      process.env.NODE_ENV = 'production';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      const expectedBinaryPath = path.join(repoRoot, 'dist', 'resources', 'server', 'voicetree-server');
      expect(config.pythonCommand).toBe(expectedBinaryPath);
      expect(config.pythonArgs).toEqual([]);
      expect(config.pythonCwd).toBe(repoRoot);
      expect(config.shouldCompilePython).toBe(true);
      expect(config.serverBinaryPath).toBe(expectedBinaryPath);
    });
  });

  describe('getBuildConfig - Production Mode (Packaged)', () => {
    beforeEach(() => {
      mockApp.isPackaged = true;
      process.env.NODE_ENV = 'production';
      process.resourcesPath = '/Applications/VoiceTree.app/Contents/Resources';
    });

    it('should use process.resourcesPath for tools in packaged app', () => {
      const env = createBuildEnv();
      const config = getBuildConfig(env);

      expect(config.toolsSource).toBe(path.join(process.resourcesPath, 'tools'));
      expect(config.backendSource).toBe(path.join(process.resourcesPath, 'backend'));
    });

    it('should use process.resourcesPath for server binary', () => {
      const env = createBuildEnv();
      const config = getBuildConfig(env);

      const expectedBinaryPath = path.join(process.resourcesPath, 'server', 'voicetree-server');
      expect(config.serverBinaryPath).toBe(expectedBinaryPath);
      expect(config.pythonCommand).toBe(expectedBinaryPath);
    });
  });

  describe('getBuildConfig - Test Mode', () => {
    it('should skip tool copying in test mode', () => {
      process.env.HEADLESS_TEST = '1';
      const env = createBuildEnv();

      const config = getBuildConfig(env);

      expect(config.shouldCopyTools).toBe(false);
    });
  });

  describe('Path Consistency', () => {
    it('should maintain same destination paths across all modes', () => {
      const devEnv = createBuildEnv();
      process.env.NODE_ENV = 'development';
      const devConfig = getBuildConfig(devEnv);

      process.env.NODE_ENV = 'production';
      const prodEnv = createBuildEnv();
      const prodConfig = getBuildConfig(prodEnv);

      // Destinations should be same regardless of mode
      expect(devConfig.toolsDest).toBe(prodConfig.toolsDest);
      expect(devConfig.backendDest).toBe(prodConfig.backendDest);
    });

    it('should change source paths based on packaging', () => {
      // Unpackaged
      mockApp.isPackaged = false;
      const unpackagedEnv = createBuildEnv();
      const unpackagedConfig = getBuildConfig(unpackagedEnv);

      // Packaged
      mockApp.isPackaged = true;
      process.resourcesPath = '/Applications/VoiceTree.app/Contents/Resources';
      const packagedEnv = createBuildEnv();
      const packagedConfig = getBuildConfig(packagedEnv);

      // Source should differ
      expect(unpackagedConfig.toolsSource).not.toBe(packagedConfig.toolsSource);
      expect(unpackagedConfig.backendSource).not.toBe(packagedConfig.backendSource);
    });
  });

  describe('Edge Cases', () => {
    it('should default to production if NODE_ENV not set', () => {
      delete process.env.NODE_ENV;
      const env = createBuildEnv();

      expect(env.nodeEnv).toBe('production');
    });

    it('should handle missing environment variables gracefully', () => {
      delete process.env.NODE_ENV;
      delete process.env.HEADLESS_TEST;

      expect(() => createBuildEnv()).not.toThrow();
      expect(() => getBuildConfig(createBuildEnv())).not.toThrow();
    });
  });
});
