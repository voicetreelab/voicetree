import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import {getProjectDotVoicetreePath} from '@vt/paths';

/**
 * Ensure {projectRoot}/.voicetree/ has the hooks directory and bookkeeping
 * files. No hook scripts are provisioned by default: the worktree hooks are
 * referenced in place (scripts/git/worktree/on-created-*.sh, the settings
 * default) and any onNewNode hook is user-configured under .voicetree/hooks/.
 * Prompts live solely at ~/.voicetree/prompts, seeded by the vtd daemon at
 * boot (see @vt/vt-daemon's ensureHomePrompts).
 *
 * Idempotent on every open:
 * - Ensures the .voicetree/hooks/ directory exists (the user-hook location).
 * - Always writes .version (tracks which app version set up the directory)
 * - Writes .gitignore only if missing
 */
export async function ensureProjectDotVoicetree(projectRoot: string): Promise<void> {
  const dotVoicetree: string = getProjectDotVoicetreePath(projectRoot);

  // Ensure .voicetree/ and the user-hook directory exist
  await fs.mkdir(path.join(dotVoicetree, 'hooks'), { recursive: true });

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
