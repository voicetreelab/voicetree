/**
 * Build Configuration - Single Source of Truth
 *
 * All path resolution and dev/prod/test logic lives here.
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

  // Server binary path (production only)
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

  // Compute repo root from app path
  // In dev: appPath = /path/to/VoiceTree/frontend/webapp
  // In packaged: appPath = /path/to/VoiceTree.app/Contents/Resources/app.asar
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
  return {
    // Python server configuration
    ...getPythonConfig(env),

    // Tools and backend configuration
    ...getToolsConfig(env),
  };
}

/**
 * Python server configuration strategy
 */
function getPythonConfig(env: BuildEnv): Pick<
  BuildConfig,
  'pythonCommand' | 'pythonArgs' | 'pythonCwd' | 'shouldCompilePython' | 'serverBinaryPath'
> {
  // Development: Run Python directly from source
  if (env.nodeEnv === 'development') {
    return {
      pythonCommand: 'python',
      pythonArgs: ['server.py'],
      pythonCwd: path.join(env.rootDir, 'backend'),
      shouldCompilePython: false,
      serverBinaryPath: null
    };
  }

  // Production/Packaged: Run compiled binary
  const serverBinaryPath = env.isPackaged
    ? path.join(process.resourcesPath, 'server', 'voicetree-server')
    : path.join(env.rootDir, 'dist', 'resources', 'server', 'voicetree-server');

  return {
    pythonCommand: serverBinaryPath,
    pythonArgs: [],
    pythonCwd: env.rootDir,
    shouldCompilePython: true,
    serverBinaryPath
  };
}

/**
 * Tools and backend modules configuration strategy
 */
function getToolsConfig(env: BuildEnv): Pick<
  BuildConfig,
  'toolsSource' | 'toolsDest' | 'backendSource' | 'backendDest' | 'shouldCopyTools'
> {
  // Destination is always Application Support
  const toolsDest = path.join(env.userDataPath, 'tools');
  const backendDest = path.join(env.userDataPath, 'backend');

  // Source depends on packaging
  const toolsSource = env.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(env.rootDir, 'tools');  // Dev: copy from repo source

  const backendSource = env.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(env.rootDir, 'backend');  // Dev: copy from repo source

  // Skip copying in test mode for fast startup
  const shouldCopyTools = !env.isTest;

  return {
    toolsSource,
    toolsDest,
    backendSource,
    backendDest,
    shouldCopyTools
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
