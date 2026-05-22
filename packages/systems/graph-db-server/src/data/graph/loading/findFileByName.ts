import { rgPath } from '@vscode/ripgrep';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

// Transform asar path to unpacked path for Windows/Linux production builds
// spawn() doesn't use Electron's asar interception, so we must manually redirect
const actualRgPath: string = rgPath.replace('app.asar', 'app.asar.unpacked');

type RipgrepFileSearchPlan = {
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
};

function escapeGlobPattern(pattern: string): string {
  return pattern.replace(/[[\]*?{}]/g, '\\$&');
}

function createMarkdownFilenameGlob(pattern: string): string {
  const escapedPattern: string = escapeGlobPattern(pattern);
  return escapedPattern === '' ? '**/*.md' : `**/${escapedPattern}.md`;
}

function createRipgrepFileSearchPlan(
  pattern: string,
  searchPath: string,
  maxDepth: number
): RipgrepFileSearchPlan {
  return {
    executablePath: actualRgPath,
    args: [
      '--files',
      '--max-depth', String(maxDepth),
      '-g', createMarkdownFilenameGlob(pattern),
      searchPath
    ],
    cwd: searchPath
  };
}

function isRipgrepFileSearchSuccess(code: number | null): boolean {
  return code === 0 || code === 1;
}

function parseRipgrepFileSearchOutput(stdout: string): string[] {
  return stdout.trim().split('\n').filter(Boolean);
}

function createRipgrepFileSearchError(code: number | null, stderr: string): Error {
  return new Error(`ripgrep exited with code ${code}: ${stderr}`);
}

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
  const plan: RipgrepFileSearchPlan = createRipgrepFileSearchPlan(pattern, searchPath, maxDepth);

  return new Promise((resolve, reject) => {
    const rg: ChildProcessWithoutNullStreams = spawn(plan.executablePath, plan.args, { cwd: plan.cwd });

    let stdout: string = '';
    let stderr: string = '';

    rg.stdout.on('data', (data: Buffer) => { stdout += data; });
    rg.stderr.on('data', (data: Buffer) => { stderr += data; });

    rg.on('close', (code) => {
      if (isRipgrepFileSearchSuccess(code)) {
        resolve(parseRipgrepFileSearchOutput(stdout));
      } else {
        reject(createRipgrepFileSearchError(code, stderr));
      }
    });

    rg.on('error', reject);
  });
}
