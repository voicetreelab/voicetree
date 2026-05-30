import { promises as fs } from 'fs';
import type { Dirent } from 'fs';
import path from 'path';
import { app } from 'electron';
import {getProjectDotVoicetreePath} from '@vt/paths';
import { getBuildConfig } from '@/shell/edge/main/runtime/electron/app/build-config';
import type { BuildConfig } from '@/shell/edge/main/runtime/electron/app/build-config';

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
 * Copy specific files from sourceDir to destDir (creates destDir if needed),
 * per-file idempotent: existing files in destDir are preserved (user
 * customizations), missing ones are filled from sourceDir. Source files that
 * don't exist are skipped silently (graceful for partial installs).
 */
async function copySpecificFiles(sourceDir: string, destDir: string, fileNames: readonly string[]): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  for (const fileName of fileNames) {
    const src: string = path.join(sourceDir, fileName);
    const dest: string = path.join(destDir, fileName);
    try {
      await fs.access(dest);
      continue;
    } catch {
      // Dest doesn't exist — fall through to copy.
    }
    try {
      await fs.copyFile(src, dest);
    } catch {
      // Source file missing — skip gracefully
    }
  }
}

/**
 * Mirror every file in sourceDir into destDir as a symlink pointing back at the
 * source, making the source the single source of truth: edits to a source prompt
 * propagate instantly with no re-copy, so the project's prompts can never drift
 * from the shipped originals. Per-file resolution:
 * - dest missing        → create the symlink
 * - dest is a symlink    → repoint it at the current source (handles the app
 *                          moving, or the dev↔packaged source path changing)
 * - dest is a real file  → leave untouched (intentional per-project override)
 * Dangling symlinks (source file removed/renamed) are pruned. A missing
 * sourceDir is a silent no-op (graceful for partial installs).
 */
export async function mirrorDirAsSymlinks(sourceDir: string, destDir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return; // Source dir absent — nothing to mirror.
  }
  await fs.mkdir(destDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src: string = path.join(sourceDir, entry.name);
    const dest: string = path.join(destDir, entry.name);
    const existing: Awaited<ReturnType<typeof fs.lstat>> | null = await fs.lstat(dest).catch(() => null);
    if (existing === null) {
      await fs.symlink(src, dest);
    } else if (existing.isSymbolicLink()) {
      const current: string | null = await fs.readlink(dest).catch(() => null);
      if (current !== src) {
        await fs.rm(dest);
        await fs.symlink(src, dest);
      }
    }
    // Real file → user override; leave untouched.
  }

  // Prune dangling symlinks whose source file no longer exists.
  const destEntries: Dirent[] = await fs.readdir(destDir, { withFileTypes: true }).catch(() => []);
  for (const entry of destEntries) {
    if (!entry.isSymbolicLink()) continue;
    const dest: string = path.join(destDir, entry.name);
    const targetExists: boolean = await fs.access(dest).then(() => true).catch(() => false);
    if (!targetExists) await fs.rm(dest);
  }
}

/**
 * Ensure {projectRoot}/.voicetree/ has default prompts and hook scripts.
 *
 * Idempotent on every open:
 * - Prompts are symlinked to the shipped source (single source of truth, no
 *   drift); a real file in .voicetree/prompts/ overrides per-project.
 * - Hooks are copied per-file (fills gaps, preserves user-customized files).
 * - Always writes .version (tracks which app version set up the directory)
 * - Writes .gitignore only if missing
 */
export async function ensureProjectDotVoicetree(projectRoot: string): Promise<void> {
  const config: BuildConfig = getBuildConfig();
  const dotVoicetree: string = getProjectDotVoicetreePath(projectRoot);

  // Ensure .voicetree/ directory exists
  await fs.mkdir(dotVoicetree, { recursive: true });

  // Symlink prompts to the shipped source — one source of truth, no drift.
  const promptsDest: string = path.join(dotVoicetree, 'prompts');
  await mirrorDirAsSymlinks(config.promptsSource, promptsDest);

  // Copy hooks (per-file idempotent — fills gaps, preserves user-customized files)
  const hooksDest: string = path.join(dotVoicetree, 'hooks');
  await copySpecificFiles(config.hookScriptsSource, hooksDest, HOOK_SCRIPT_FILES);
  const hookPromptsSource: string = path.join(config.hookScriptsSource, 'prompts');
  const hookPromptsDest: string = path.join(hooksDest, 'prompts');
  await copySpecificFiles(hookPromptsSource, hookPromptsDest, HOOK_PROMPT_FILES);

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
