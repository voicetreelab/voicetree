/**
 * Build Configuration - Single Source of Truth
 *
 * All absolutePath resolution and dev/prod/test logic lives here.
 * This prevents scattered conditional logic across the codebase.
 *
 * Usage:
 *   const env = createBuildEnv()
 *   const config = getBuildConfig(env)
 *   // Use config.toolsSource, config.pythonBinary, etc.
 */

import { app } from 'electron';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export type NodeEnv = 'development' | 'production' | 'test';

export type BuildEnv = {
  readonly nodeEnv: NodeEnv;
  readonly isPackaged: boolean;
  readonly isTest: boolean;
  readonly rootDir: string;      // VoiceTree repo root
  readonly appPath: string;       // Electron app.getAppPath()
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
// Environment Detection (Pure Functions)
// ============================================================================

/**
 * Create BuildEnv from current Electron environment
 * This is the ONLY function with side effects (reads from app/process)
 */
export function createBuildEnv(): BuildEnv {
  const nodeEnv = (process.env.NODE_ENV || 'production') as NodeEnv;
  const isTest = process.env.HEADLESS_TEST === '1' || nodeEnv === 'test';
  const isPackaged = app.isPackaged;
  const appPath = app.getAppPath();

  // Compute repo root from app absolutePath
  // In dev: appPath = /absolutePath/to/VoiceTree/frontend/webapp
  // In packaged: appPath = /absolutePath/to/VoiceTree.app/Contents/Resources/app.asar
  const rootDir = isPackaged
    ? path.dirname(process.resourcesPath)
    : path.resolve(appPath, '../..');

  const userDataPath = app.getPath('userData');

  return {
    nodeEnv,
    isPackaged,
    isTest,
    rootDir,
    appPath,
    userDataPath
  };
}

// ============================================================================
// Configuration Computation (Pure Functions)
// ============================================================================

/**
 * Compute all build configuration from environment
 * Pure function - same env always produces same config
 */
export function getBuildConfig(env: BuildEnv): BuildConfig {
  return env.nodeEnv === 'development'
    ? getBuildConfigDev(env)
    : getBuildConfigProd(env);
}

/**
 * Development configuration - run Python directly from source
 */
function getBuildConfigDev(env: BuildEnv): BuildConfig {
  return {
    // Python: Run directly from source
    pythonCommand: 'python',
    pythonArgs: ['server.py'],
    pythonCwd: path.join(env.rootDir, 'backend'),
    shouldCompilePython: false,
    serverBinaryPath: null,

    // Tools: Copy from repo source
    toolsSource: path.join(env.rootDir, 'tools'),
    toolsDest: path.join(env.userDataPath, 'tools'),
    backendSource: path.join(env.rootDir, 'backend'),
    backendDest: path.join(env.userDataPath, 'backend'),
    shouldCopyTools: !env.isTest,
  };
}

/**
 * Production configuration - run compiled binary
 */
function getBuildConfigProd(env: BuildEnv): BuildConfig {
  // Binary location depends on packaging state
  const serverBinaryPath = env.isPackaged
    ? path.join(process.resourcesPath, 'server', 'voicetree-server')
    : path.join(env.rootDir, 'dist', 'resources', 'server', 'voicetree-server');

  // Tools source depends on packaging state
  const toolsSource = env.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(env.rootDir, 'tools');

  const backendSource = env.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(env.rootDir, 'backend');

  return {
    // Python: Run compiled binary
    pythonCommand: serverBinaryPath,
    pythonArgs: [],
    pythonCwd: env.rootDir,
    shouldCompilePython: true,
    serverBinaryPath,

    // Tools: Copy from packaged resources or build output
    toolsSource,
    toolsDest: path.join(env.userDataPath, 'tools'),
    backendSource,
    backendDest: path.join(env.userDataPath, 'backend'),
    shouldCopyTools: !env.isTest,
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
  const env = createBuildEnv();
  const config = getBuildConfig(env);
  console.log(JSON.stringify(config, null, 2));
}

// CLI support removed - incompatible with ES modules
// To run as CLI, use: node -e "import('./build-config.js').then(m => m.printConfig())"
