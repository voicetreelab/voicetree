import { rgPath } from '@vscode/ripgrep';
import { spawn } from 'child_process';

/**
 * Find markdown files matching a suffix pattern using ripgrep.
 * Used to resolve relative wikilinks like [note] → /path/to/note.md
 *
 * @param pattern - The filename pattern to match (e.g., "note" matches "*note*.md")
 * @param searchPath - The directory to search in
 * @param maxDepth - Maximum directory depth to search (default 10)
 * @returns Array of absolute file paths matching the pattern
 */
export async function findFileByName(
  pattern: string,
  searchPath: string,
  maxDepth = 10
): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const rg: ReturnType<typeof spawn> = spawn(rgPath, [
      '--files',
      '--max-depth', String(maxDepth),
      '-g', `*${pattern}*.md`,
      searchPath
    ]);

    let stdout: string = '';
    let stderr: string = '';

    rg.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    rg.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    rg.on('close', (code: number | null) => {
      if (code === 0 || code === 1) { // 1 = no matches (not an error for ripgrep)
        resolve(stdout.trim().split('\n').filter(Boolean));
      } else {
        reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
      }
    });

    rg.on('error', reject);
  });
}
