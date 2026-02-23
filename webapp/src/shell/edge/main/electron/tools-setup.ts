import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import { getBuildConfig } from './build-config';
import type { BuildConfig } from '@/shell/edge/main/electron/build-config';
import type { Dirent } from 'fs';

const VERSION_FILE: string = '.voicetree-version';

// Files to copy into {projectRoot}/.voicetree/prompts/
const PROJECT_PROMPT_FILES: readonly string[] = [
  'addProgressTree.md',
  'SUBAGENT_PROMPT.md',
  'CREATE_SUBAGENTS_COMMAND.md',
  'decompose_subtask_dependency_graph.md',
  'subtask_template.md',
  'addProgressTreeManualFallback.md',
];

// Hook scripts to copy into {projectRoot}/.voicetree/hooks/
const HOOK_SCRIPT_FILES: readonly string[] = [
  'on-new-node.cjs',
  'on-worktree-created-blocking.sh',
  'on-worktree-created-async.sh',
];

// Hook prompt files to copy into {projectRoot}/.voicetree/hooks/prompts/
const HOOK_PROMPT_FILES: readonly string[] = [
  'muse.md',
  'gardener.md',
  'dispatcher.md',
];

/**
 * Check if tools are already installed for current app version
 */
async function isCurrentVersionInstalled(destDir: string): Promise<boolean> {
  try {
    const versionPath: string = path.join(destDir, VERSION_FILE);
    const installedVersion: string = await fs.readFile(versionPath, 'utf-8');
    return installedVersion.trim() === app.getVersion();
  } catch {
    return false;
  }
}

/**
 * Write current app version to destination directory
 */
async function writeVersionFile(destDir: string): Promise<void> {
  const versionPath: string = path.join(destDir, VERSION_FILE);
  await fs.writeFile(versionPath, app.getVersion());
}

/**
 * Get the tools directory absolutePath in Application Support
 * Returns the user-writable location where agent tools are stored
 */
export function getToolsDirectory(): string {
  const config: BuildConfig = getBuildConfig();
  return config.toolsDest;
}

/**
 * Get the backend directory absolutePath in Application Support
 * Returns the user-writable location where backend modules are stored
 */
export function getBackendDirectory(): string {
  const config: BuildConfig = getBuildConfig();
  return config.backendDest;
}

/**
 * Recursive async copy function
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries: Dirent<string>[] = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath: string = path.join(src, entry.name);
    const destPath: string = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Set up agent tools and backend directories
 * Copies tools and backend modules from source to Application Support, overwriting existing files
 *
 * SKIPS entirely in test mode (HEADLESS_TEST=1) for fast test startup
 *
 * Uses centralized build-config for all absolutePath resolution
 */
export async function setupToolsDirectory(): Promise<void> {
  const config: BuildConfig = getBuildConfig();

  // Skip entirely in test mode
  if (!config.shouldCopyTools) {
    //console.log('[Setup] Skipping tools setup in test mode');
    return;
  }

  // Add timeout wrapper (10 seconds max)
  const timeoutPromise: Promise<void> = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(new Error('[Setup] Timeout: tools setup took > 10 seconds'));
    }, 10000);
  });

  const setupPromise: Promise<void> = setupToolsDirectoryInternal(config);

  return Promise.race([setupPromise, timeoutPromise]);
}

async function setupToolsDirectoryInternal(config: ReturnType<typeof getBuildConfig>): Promise<void> {
  try {
    const { toolsSource, toolsDest, backendSource, backendDest } = config;

    // Skip if current version already installed
    if (await isCurrentVersionInstalled(toolsDest)) {
      //console.log(`[Setup] Tools already installed for version ${app.getVersion()}, skipping copy`);
      return;
    }

    // Remove existing directories if they exist to ensure fresh copy
    try {
      await fs.rm(toolsDest, { recursive: true, force: true });
      //console.log('[Setup] Removed existing tools directory');
    } catch {
      // Directory doesn't exist, which is fine
    }

    try {
      await fs.rm(backendDest, { recursive: true, force: true });
      //console.log('[Setup] Removed existing backend directory');
    } catch {
      // Directory doesn't exist, which is fine
    }

    //console.log('[Setup] Setting up tools and backend directories...');
    //console.log('[Setup] Source paths from build-config:');
    //console.log('[Setup]   Tools:', toolsSource);
    //console.log('[Setup]   Backend:', backendSource);

    // Verify source directories exist
    let toolsExist: boolean = false;
    let backendExist: boolean = false;

    try {
      await fs.access(toolsSource);
      toolsExist = true;
    } catch (_error) {
      console.error('[Setup] Source tools directory not found at:', toolsSource);
    }

    try {
      await fs.access(backendSource);
      backendExist = true;
    } catch (_error) {
      console.error('[Setup] Source backend directory not found at:', backendSource);
    }

    if (!toolsExist && !backendExist) {
      console.warn('[Setup] Neither tools nor backend directories found. Creating empty directories.');
    }

    // Always create tools directory (for terminal cwd)
    await fs.mkdir(toolsDest, { recursive: true });
    //console.log('[Setup] ✓ Created tools directory at:', toolsDest);

    // Copy tools directory if source exists
    if (toolsExist) {
      await copyDir(toolsSource, toolsDest);
      //console.log('[Setup] ✓ Copied tools to:', toolsDest);
    }

    // Create backend directory if needed
    await fs.mkdir(backendDest, { recursive: true });

    // Copy backend directory if source exists
    if (backendExist) {
      await copyDir(backendSource, backendDest);
      //console.log('[Setup] ✓ Copied backend to:', backendDest);
    }

    // Write version file so we skip copy on next launch
    await writeVersionFile(toolsDest);
    //console.log(`[Setup] ✓ Wrote version file for ${app.getVersion()}`);

    //console.log('[Setup] Setup complete!');
  } catch (error) {
    console.error('[Setup] Error setting up directories:', error);
    throw error; // Fail fast
  }
}

/**
 * Copy specific files from sourceDir to destDir (creates destDir if needed).
 * Skips files that don't exist in the source — graceful for partial installs.
 */
async function copySpecificFiles(sourceDir: string, destDir: string, fileNames: readonly string[]): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  for (const fileName of fileNames) {
    const src: string = path.join(sourceDir, fileName);
    const dest: string = path.join(destDir, fileName);
    try {
      await fs.copyFile(src, dest);
    } catch {
      // Source file missing — skip gracefully (partial install or bundling difference)
    }
  }
}

/**
 * Ensure {projectRoot}/.voicetree/ has default prompts and hook scripts.
 *
 * Idempotent copy-on-first-open:
 * - If .voicetree/prompts/ exists, skip prompt copy (user may have customized)
 * - If .voicetree/hooks/ exists, skip hook copy (user may have customized)
 * - Always writes .version (tracks which app version set up the directory)
 * - Writes .gitignore only if missing
 */
export async function ensureProjectDotVoicetree(projectRoot: string): Promise<void> {
  const config: BuildConfig = getBuildConfig();
  const dotVoicetree: string = path.join(projectRoot, '.voicetree');

  // Ensure .voicetree/ directory exists
  await fs.mkdir(dotVoicetree, { recursive: true });

  // Copy prompts (skip if directory already exists — user may have customized)
  const promptsDest: string = path.join(dotVoicetree, 'prompts');
  try {
    await fs.access(promptsDest);
    // Directory exists — skip
  } catch {
    await copySpecificFiles(config.promptsSource, promptsDest, PROJECT_PROMPT_FILES);
  }

  // Copy hooks (skip if directory already exists — user may have customized)
  const hooksDest: string = path.join(dotVoicetree, 'hooks');
  try {
    await fs.access(hooksDest);
    // Directory exists — skip
  } catch {
    // Copy hook scripts
    await copySpecificFiles(config.hookScriptsSource, hooksDest, HOOK_SCRIPT_FILES);
    // Copy hook prompts (muse.md, gardener.md, dispatcher.md)
    const hookPromptsSource: string = path.join(config.hookScriptsSource, 'prompts');
    const hookPromptsDest: string = path.join(hooksDest, 'prompts');
    await copySpecificFiles(hookPromptsSource, hookPromptsDest, HOOK_PROMPT_FILES);
  }

  // Always write .version with current app version
  await fs.writeFile(path.join(dotVoicetree, '.version'), app.getVersion());

  // Write .gitignore only if missing (user may have customized)
  const gitignorePath: string = path.join(dotVoicetree, '.gitignore');
  try {
    await fs.access(gitignorePath);
    // Exists — don't overwrite
  } catch {
    await fs.writeFile(gitignorePath, 'positions.json\n');
  }
}
