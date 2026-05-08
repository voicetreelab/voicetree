import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP: (file: string, args: readonly string[], options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

const OSASCRIPT_TIMEOUT_MS: number = 5000;

function buildAppleScript(launchCommand: string, slashCommand: string): string {
  const safeLaunch: string = launchCommand.replace(/"/g, '\\"');
  const safeSlash: string = slashCommand.replace(/"/g, '\\"');
  return `tell application "Terminal"
  activate
  set newTab to do script "${safeLaunch}"
  delay 3
  do script "${safeSlash}" in newTab
end tell`;
}

async function runAppleScript(script: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Open-in-terminal only supported on macOS');
  }
  await execFileP('osascript', ['-e', script], { timeout: OSASCRIPT_TIMEOUT_MS });
}

export async function openClaudeUsage(): Promise<void> {
  await runAppleScript(buildAppleScript('claude', '/usage'));
}

export async function openCodexStatus(): Promise<void> {
  await runAppleScript(buildAppleScript('codex', '/status'));
}
