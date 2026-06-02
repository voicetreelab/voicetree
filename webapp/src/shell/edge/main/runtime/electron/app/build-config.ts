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
import {resolveVoicetreeHomePath} from '@vt/paths';

// ============================================================================
// Types
// ============================================================================

export type NodeEnv = 'development' | 'production' | 'test';

type CommonEnv = {
  readonly nodeEnv: NodeEnv;
  readonly isPackaged: boolean;
  readonly isTest: boolean;
  readonly userDataPath: string;
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

  // Per-project .voicetree/ hook source (copy-on-first-open).
  readonly hookScriptsSource: string;   // scripts/ (on-new-node.cjs, on-worktree-created-*.sh, prompts/)
  // Absolute path to the `@voicetree/cli` package root on disk. Spawn-time
  // PATH injection (resolveVtBinDir + prependVtBinToPath) reads `bin/vt`
  // from inside this directory. Null when this build cannot locate the CLI
  // (e.g. a packaged Electron build that did not bundle voicetree-cli);
  // PATH injection then no-ops gracefully.
  readonly voicetreeCliPackageDir: string | null;

  // Server binary absolutePath (production only)
  readonly serverBinaryPath: string | null;

  // Absolute path to the bundled standalone Node ≥22 that hosts the per-project
  // daemons (vtd + its vt-graphd sibling), or null when this build ships none.
  // Those daemons need node:sqlite (Node ≥22) and must NOT run on Electron's own
  // node (architecture.md), so the packaged app carries its own node under
  // Resources/node/. Null in dev and unpackaged builds: the runtime resolver
  // then falls back to a `node` on PATH. main.ts exports this as
  // VT_GRAPHD_NODE_BIN, which graph-db-client's resolver selects first — and
  // which vt-daemon-client reuses for vtd (both go through the same resolver).
  readonly graphdNodeBinaryPath: string | null;
};

// ============================================================================
// Configuration Computation
// ============================================================================

/**
 * Compute all build configuration from current environment
 * Reads from app/process to determine dev vs prod configuration
 * USE_REAL_SERVER=1 forces development config (runs python server.py directly)
 */
export function getBuildConfig(): BuildConfig {
  const commonEnv: CommonEnv = getCommonEnv();
  const useRealServer: boolean = process.env.USE_REAL_SERVER === '1';
  return (commonEnv.nodeEnv === 'development' || useRealServer)
    ? getBuildConfigDev(commonEnv)
    : getBuildConfigProd(commonEnv);
}

/**
 * Get common environment values used by both dev and prod configs
 */
function getCommonEnv(): CommonEnv {
  const nodeEnv: NodeEnv = (process.env.NODE_ENV ?? 'production') as NodeEnv;
  const isTest: boolean = process.env.HEADLESS_TEST === '1' || nodeEnv === 'test';
  const isPackaged: boolean = app.isPackaged;
  const userDataPath: string = resolveVoicetreeHomePath();

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
  // Use process.cwd() which is /path/to/voicetree-public/webapp
  // Go up 1 level to get repo root (where server.py lives)
  // Note: app.getAppPath() returns dist-electron/main when running built version,
  // which would require going up 3 levels. Using cwd is more reliable.
  const rootDir: string = path.resolve(process.cwd(), '..');

  return {
    // Python: Run directly from source via uv (handles venv automatically)
    // uv is found via PATH (enhanced in RealTextToTreeServerManager.buildServerEnvironment)
    pythonCommand: 'uv',
    pythonArgs: ['run', 'python', 'server.py'],
    pythonCwd: rootDir,
    shouldCompilePython: false,
    serverBinaryPath: null,
    // Dev runs the daemons from source via the dev `node` on PATH (already ≥22).
    graphdNodeBinaryPath: null,

    // Tools: Copy from repo source
    toolsSource: path.join(rootDir, 'tools'),
    toolsDest: path.join(commonEnv.userDataPath, 'tools'),
    backendSource: path.join(rootDir, 'backend'),
    backendDest: path.join(commonEnv.userDataPath, 'backend'),
    shouldCopyTools: !commonEnv.isTest,

    // Per-project .voicetree/ hook source
    hookScriptsSource: path.join(rootDir, 'scripts'),
    voicetreeCliPackageDir: path.join(rootDir, 'packages', 'systems', 'voicetree-cli'),
  };
}

/**
 * Production configuration - run compiled binary
 */
function getBuildConfigProd(commonEnv: CommonEnv): BuildConfig {
  // Compute repo root from app path
  // In packaged: appPath = /path/to/Voicetree.app/Contents/Resources/app.asar
  // In unpackaged prod: appPath = /path/to/voicetree-public/webapp
  const appPath: string = app.getAppPath();
  const rootDir: string = commonEnv.isPackaged
    ? path.dirname(process.resourcesPath)
    : path.resolve(appPath, '..');

  // Binary location depends on packaging state
  const serverBinaryName: string = process.platform === 'win32' ? 'voicetree-server.exe' : 'voicetree-server';
  const serverBinaryPath: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'server', serverBinaryName)
    : path.join(rootDir, 'out', 'resources', 'server', serverBinaryName);

  // Standalone Node ≥22 hosting the daemons. Only the packaged app ships one
  // (under Resources/node/, placed there by extraResources + stage:node); an
  // unpackaged prod build has none, so the daemons resolve a `node` from PATH.
  const nodeBinaryName: string = process.platform === 'win32' ? 'node.exe' : 'node';
  const graphdNodeBinaryPath: string | null = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'node', nodeBinaryName)
    : null;

  // Tools source depends on packaging state
  const toolsSource: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(rootDir, 'tools');

  const backendSource: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(rootDir, 'backend');

  // TODO(packaging-followup): wire `packages/systems/voicetree-cli/` (the bin
  // script + the `dist/voicetree-cli.js` bundle produced by `npm run build`)
  // into the packaged-app `extraResources` so this resolves under
  // process.resourcesPath in production. Until that lands, packaged builds
  // leave the CLI package dir null and spawned agents fall through the
  // no-op PATH injection — they can still reach the daemon via
  // VOICETREE_DAEMON_URL but cannot call `vt` as a bare command.
  // Unpackaged dev/prod resolves directly to the monorepo source.
  const voicetreeCliPackageDir: string | null = commonEnv.isPackaged
    ? null
    : path.join(rootDir, 'packages', 'systems', 'voicetree-cli');

  const hookScriptsSource: string = commonEnv.isPackaged
    ? path.join(process.resourcesPath, 'scripts')
    : path.join(rootDir, 'scripts');

  return {
    // Python: Run compiled binary
    pythonCommand: serverBinaryPath,
    pythonArgs: [],
    pythonCwd: rootDir,
    shouldCompilePython: true,
    serverBinaryPath,
    graphdNodeBinaryPath,

    // Tools: Copy from packaged resources or build output
    toolsSource,
    toolsDest: path.join(commonEnv.userDataPath, 'tools'),
    backendSource,
    backendDest: path.join(commonEnv.userDataPath, 'backend'),
    shouldCopyTools: !commonEnv.isTest,

    // Per-project .voicetree/ hook source
    hookScriptsSource,
    voicetreeCliPackageDir,
  };
}
