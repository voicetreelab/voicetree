import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import {getProjectDotVoicetreePath} from '@vt/paths';
import { getBuildConfig } from '@/shell/edge/main/runtime/electron/app/build-config';
import type { BuildConfig } from '@/shell/edge/main/runtime/electron/app/build-config';

// Files to copy into {projectRoot}/.voicetree/prompts/
const PROJECT_PROMPT_FILES: readonly string[] = [
  'addProgressTree.md',
  'SUBAGENT_PROMPT.md',
  'CREATE_SUBAGENTS_COMMAND.md',
  'decompose_subtask_dependency_graph.md',
  'subtask_template.md',
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
  const dotVoicetree: string = getProjectDotVoicetreePath(projectRoot);

  // Ensure .voicetree/ directory exists
  await fs.mkdir(dotVoicetree, { recursive: true });

  // Copy prompts (per-file idempotent — fills gaps, preserves user-customized files)
  const promptsDest: string = path.join(dotVoicetree, 'prompts');
  await copySpecificFiles(config.promptsSource, promptsDest, PROJECT_PROMPT_FILES);

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
