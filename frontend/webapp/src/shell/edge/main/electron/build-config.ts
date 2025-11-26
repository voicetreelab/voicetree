/**
 * Build Configuration - Single Source of Truth
 *
 * All absolutePath resolution and dev/prod/test logic lives here.
 * This prevents scattered conditional logic across the codebase.
 *
 * Usage:
 *   const config = getBuildConfig()
 *   // Use config.toolsSource, config.pythonBinary, etc.
 */

import { app } from 'electron';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type NodeEnv = 'development' | 'production' | 'test';

type CommonEnv = {
  readonly nodeEnv: NodeEnv;
  readonly isPackaged: boolean;
  readonly isTest: boolean;
  readonly userDataPath: string;  // Application Support directory
};

export type BuildConfig = {
  // Python server paths
  readonly pythonCommand: string;
  readonly pythonArgs: readonly string[];
  readonly pythonCwd: string;
  readonly shouldCompilePython: boolean;

  // Tools and backend paths
  readonly toolsSource: string;
  readonly toolsDest: string;
  readonly backendSource: string;
  readonly backendDest: string;
  readonly shouldCopyTools: boolean;

  // Server binary absolutePath (production only)
  readonly serverBinaryPath: string | null;
};

// ============================================================================
// Configuration Computation
// ============================================================================

/**
 * Compute all build configuration from current environment
 * Reads from app/process to determine dev vs prod configuration
 */
export function getBuildConfig(): BuildConfig {
  const commonEnv: CommonEnv = getCommonEnv();
  return commonEnv.nodeEnv === 'development'
    ? getBuildConfigDev(commonEnv)
    : getBuildConfigProd(commonEnv);
}

/**
 * Get common environment values used by both dev and prod configs
 */
function getCommonEnv(): CommonEnv {
  const nodeEnv: NodeEnv = (process.env.NODE_ENV || 'production') as NodeEnv;
  const isTest: boolean = process.env.HEADLESS_TEST === '1' || nodeEnv === 'test';
  const isPackaged: boolean = app.isPackaged;
  const userDataPath: string = app.getPath('userData');

  return {
    nodeEnv,
    isPackaged,
    isTest,
    userDataPath
  };
}

/**
 * Development configuration - run Python directly from source
 */
function getBuildConfigDev(commonEnv: CommonEnv): BuildConfig {
  // In dev: appPath = /path/to/VoiceTree/frontend/webapp
  const appPath: string = app.getAppPath();
  const rootDir: string = path.resolve(appPath, '../..');

  return {
    // Python: Run directly from source
    pythonCommand: 'python',
    pythonArgs: ['server.py'],
    pythonCwd: rootDir,
    shouldCompilePython: false,
    serverBinaryPath: null,

    // Tools: Copy from repo source
    toolsSource: path.join(rootDir, 'tools'),
    toolsDest: path.join(commonEnv.userDataPath, 'tools'),
    backendSource: path.join(rootDir, 'backend'),
    backendDest: path.join(commonEnv.userDataPath, 'backend'),
    shouldCopyTools: !commonEnv.isTest,
  };
}

/**
 * Production configuration - run compiled binary
 */
function getBuildConfigProd(commonEnv: CommonEnv): BuildConfig {
  // Compute repo root from app path
  // In packaged: appPath = /path/to/VoiceTree.app/Contents/Resources/app.asar
  // In unpackaged prod: appPath = /path/to/VoiceTree/frontend/webapp
  const appPath: string = app.getAppPath();
  const rootDir: string = commonEnv.isPackaged
    ? path.dirname(process.resourcesPath)
    : path.resolve(appPath, '../..');

  // Binary location depends on packaging state
  const serverBinaryPath: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'server', 'voicetree-server')
    : path.join(rootDir, 'dist', 'resources', 'server', 'voicetree-server');

  // Tools source depends on packaging state
  const toolsSource: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(rootDir, 'tools');

  const backendSource: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(rootDir, 'backend');

  return {
    // Python: Run compiled binary
    pythonCommand: serverBinaryPath,
    pythonArgs: [],
    pythonCwd: rootDir,
    shouldCompilePython: true,
    serverBinaryPath,

    // Tools: Copy from packaged resources or build output
    toolsSource,
    toolsDest: path.join(commonEnv.userDataPath, 'tools'),
    backendSource,
    backendDest: path.join(commonEnv.userDataPath, 'backend'),
    shouldCopyTools: !commonEnv.isTest,
  };
}

// ============================================================================
// CLI Wrapper (For Shell Scripts)
// ============================================================================

/**
 * Print config as JSON for shell script consumption
 * Usage from bash: node -e "require('./electron/build-config').printConfig()"
 */
export function printConfig(): void {
  const config: BuildConfig = getBuildConfig();
  console.log(JSON.stringify(config, null, 2));
}

// CLI support removed - incompatible with ES modules
// To run as CLI, use: node -e "import('./build-config.js').then(m => m.printConfig())"
