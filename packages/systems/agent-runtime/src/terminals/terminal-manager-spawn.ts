import {execFileSync} from 'child_process'
import os from 'os'
import type pty from 'node-pty'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import type {TerminalData} from './terminal-registry/types'
import {feedPromptDetector, startPromptDetection, stopPromptDetection} from '../lifecycle/prompt-runner'
import {getRuntimeProjectRoot} from '../runtime/graph-bridge'
import {getRuntimeEnv} from '../runtime/runtime-config'
import {markTerminalExited, updateTerminalPromptDetected} from './terminal-registry'
import {captureOutput, clearBuffer} from './terminal-output-buffer'

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

export function signalNumberToName(signalNumber: number): string | null {
    if (!signalNumber) return null
    const map: Record<string, number> = os.constants.signals as unknown as Record<string, number>
    for (const name of Object.keys(map)) {
        if (map[name] === signalNumber) return name
    }
    return null
}

let cachedWindowsShell: string | undefined

export function getWindowsShell(
    probePwsh: () => void = (): void => {
        execFileSync('pwsh.exe', ['-Version'], { stdio: 'ignore', timeout: 3000 })
    },
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

export function buildTerminalEnvironment(
    terminalData: TerminalData,
    deps: Pick<TerminalManagerDeps, 'env'>,
): NodeJS.ProcessEnv {
    const customEnv: { [key: string]: string | undefined; TZ?: string; } = {...deps.env}

    if (terminalData.initialEnvVars) {
        Object.assign(customEnv, terminalData.initialEnvVars)
    }

    const runtimeEnv = getRuntimeEnv()
    const vaultPath: string | null = runtimeEnv.getProjectRootWatchedDirectory
        ? runtimeEnv.getProjectRootWatchedDirectory()
        : getRuntimeProjectRoot()
    customEnv.OBSIDIAN_VAULT_PATH = vaultPath ?? ''
    customEnv.WATCHED_FOLDER = vaultPath ?? undefined

    const otlpPort: number | null = runtimeEnv.getOTLPReceiverPort?.() ?? null
    if (otlpPort) {
        customEnv.CLAUDE_CODE_ENABLE_TELEMETRY = '1'
        customEnv.OTEL_METRICS_EXPORTER = 'otlp'
        customEnv.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json'
        customEnv.OTEL_EXPORTER_OTLP_ENDPOINT = `http://localhost:${otlpPort}`
    }

    return customEnv
}

export function writeInitialCommand(
    terminalData: TerminalData,
    ptyProcess: Pick<pty.IPty, 'write'>,
    setTimeoutFn: TerminalManagerDeps['setTimeout'],
): void {
    if (!terminalData.initialCommand) return
    const command: string = terminalData.executeCommand
        ? terminalData.initialCommand + '\r'
        : terminalData.initialCommand
    setTimeoutFn(() => {
        ptyProcess.write(command)
    }, 200)
}

export function startPromptDetectionForTerminal(
    terminalId: string,
    logger: TerminalManagerLogger,
): void {
    try {
        startPromptDetection(terminalId, {
            onStateChange: (id: string, change): void => {
                updateTerminalPromptDetected(id, change.kind === 'detected')
            },
        })
    } catch (err: unknown) {
        logger.error(`[TerminalManager] Failed to start prompt detection for ${terminalId}:`, err)
    }
}

export function attachPtyProcessHandlers(args: {
    terminalId: string
    ptyProcess: pty.IPty
    onData: (terminalId: string, data: string) => void
    onExit: (terminalId: string, exitCode: number, signal?: string | null) => void
    logger: TerminalManagerLogger
    releaseTerminal: () => void
}): void {
    const {terminalId, ptyProcess, onData, onExit, logger, releaseTerminal} = args

    ptyProcess.onData((data: string) => {
        captureOutput(terminalId, data)
        onData(terminalId, data)
        feedPromptDetector(terminalId, data).catch((err: unknown) => {
            logger.error(`[TerminalManager] Prompt-detector feed failed for ${terminalId}:`, err)
        })
    })

    ptyProcess.onExit((exitInfo: { exitCode: number; signal?: number }) => {
        const signalName: string | null = exitInfo.signal !== undefined
            ? signalNumberToName(exitInfo.signal)
            : null
        onExit(terminalId, exitInfo.exitCode, signalName)
        markTerminalExited(terminalId, exitInfo.exitCode, signalName)
        stopPromptDetection(terminalId)
        releaseTerminal()
        clearBuffer(terminalId)
    })
}

export function formatSpawnErrorMessage(error: unknown): string {
    const detail: string = error instanceof Error ? error.message : String(error)
    return `\r\n\x1b[31mError: Failed to spawn terminal\x1b[0m\r\n${detail}\r\n\r\n` +
        `If this is a NODE_MODULE_VERSION mismatch, rebuild native modules:\r\n` +
        `  scripts/rebuild-native.sh\r\n\r\n` +
        `Otherwise, check your shell setting (settings.shell) and that the spawn directory exists.\r\n`
}
