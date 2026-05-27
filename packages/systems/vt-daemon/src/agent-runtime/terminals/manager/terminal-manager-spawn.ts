import {execFileSync} from 'child_process'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import type {TerminalData} from '../terminal-registry/types'

export type TerminalManagerLogger = {
  error(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  trace(message?: unknown, ...optionalParams: unknown[]): void;
}

export type TerminalManagerDeps = {
  access(path: string): Promise<void>;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  env: NodeJS.ProcessEnv;
  cwd(): string;
  platform: NodeJS.Platform;
  getWindowsShell(): string;
  logger: TerminalManagerLogger;
}

let cachedWindowsShell: string | undefined

function probePwshExecutable(): void {
    execFileSync('pwsh.exe', ['-Version'], { stdio: 'ignore', timeout: 3000 })
}

export function getWindowsShell(
    probePwsh: () => void = probePwshExecutable,
): string {
    if (cachedWindowsShell) return cachedWindowsShell
    try {
        probePwsh()
        cachedWindowsShell = 'pwsh.exe'
    } catch {
        cachedWindowsShell = 'powershell.exe'
    }
    return cachedWindowsShell
}

export async function resolveTerminalShell(deps: TerminalManagerDeps): Promise<string> {
    const settings: VTSettings = await loadSettings()
    return settings.shell
        ?? (deps.platform === 'win32' ? deps.getWindowsShell() : deps.env.SHELL ?? '/bin/bash')
}

export async function resolveTerminalCwd(
    terminalData: TerminalData,
    getToolsDirectory: () => string,
    deps: TerminalManagerDeps,
): Promise<string> {
    const preferredCwd: string = terminalData.initialSpawnDirectory ?? getToolsDirectory()
    try {
        await deps.access(preferredCwd)
        return preferredCwd
    } catch {
        return deps.env.HOME ?? deps.cwd()
    }
}
