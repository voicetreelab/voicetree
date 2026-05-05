import { rgPath } from '@vscode/ripgrep';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

// Transform asar path to unpacked path for Windows/Linux production builds
// spawn() doesn't use Electron's asar interception, so we must manually redirect
const actualRgPath: string = rgPath.replace('app.asar', 'app.asar.unpacked');

/**
 * Find markdown files matching an exact filename using ripgrep.
 * Used to resolve relative wikilinks like [note] → /path/to/note.md
 *
 * @param pattern - The filename to match exactly (e.g., "note" matches "note.md" in any directory)
 * @param searchPath - The directory to search in
 * @param maxDepth - Maximum directory depth to search (default 10)
 * @returns Array of absolute file paths matching the pattern
 */
export async function findFileByName(
  pattern: string,
  searchPath: string,
  maxDepth = 10
): Promise<string[]> {
  // Escape glob-special characters to prevent ripgrep parsing errors
  // Square brackets, asterisks, question marks need escaping
  const escapedPattern: string = pattern.replace(/[[\]*?{}]/g, '\\$&');

  // Empty pattern matches all .md files, otherwise exact filename match only
  const globPattern: string = escapedPattern === '' ? '**/*.md' : `**/${escapedPattern}.md`;

  return new Promise((resolve, reject) => {
    const rg: ChildProcessWithoutNullStreams = spawn(actualRgPath, [
      '--files',
      '--max-depth', String(maxDepth),
      '-g', globPattern,
      searchPath
    ], {
      cwd: searchPath  // Explicitly set cwd to avoid ENOTDIR if process.cwd() is invalid
    });

    let stdout: string = '';
    let stderr: string = '';

    rg.stdout.on('data', (data: Buffer) => { stdout += data; });
    rg.stderr.on('data', (data: Buffer) => { stderr += data; });

    rg.on('close', (code) => {
      if (code === 0 || code === 1) { // 1 = no matches (not an error)
        resolve(stdout.trim().split('\n').filter(Boolean));
      } else {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
      }
    });

    rg.on('error', reject);
  });
}
