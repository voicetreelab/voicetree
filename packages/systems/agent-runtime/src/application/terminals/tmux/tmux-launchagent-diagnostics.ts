import {createHash} from 'node:crypto'

export interface TmuxLaunchAgentLogger {
    readonly error: (message: string) => void
    readonly warn: (message: string) => void
}

export interface TmuxLaunchAgentDiagnosticContext {
    readonly appSupportPath: string
    readonly existingPlist: string | null
    readonly launchAgentLoaded: boolean
    readonly logDir: string
    readonly plist: string
    readonly plistPath: string
    readonly socketPath: string
    readonly tmuxBin: string
}

export type TmuxLaunchAgentLogLevel = keyof TmuxLaunchAgentLogger

function sha256Text(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function stackSummary(): string {
    return new Error('tmux LaunchAgent lifecycle path').stack
        ?.split('\n')
        .slice(2, 9)
        .map((line: string) => line.trim())
        .join(' | ')
        ?? 'stack unavailable'
}

export function buildTmuxLaunchAgentDiagnostics(context: TmuxLaunchAgentDiagnosticContext): Record<string, unknown> {
    return {
        appSupportPath: context.appSupportPath,
        currentPlistSha256: context.existingPlist === null ? null : sha256Text(context.existingPlist),
        launchAgentLoaded: context.launchAgentLoaded,
        logDir: context.logDir,
        plistPath: context.plistPath,
        renderedPlistSha256: sha256Text(context.plist),
        socketPath: context.socketPath,
        tmuxBin: context.tmuxBin,
    }
}

export function logTmuxLaunchAgentEvent(
    logger: TmuxLaunchAgentLogger,
    level: TmuxLaunchAgentLogLevel,
    event: string,
    details: Record<string, unknown>,
): void {
    logger[level](`[tmux-launchagent] ${event} ${JSON.stringify({
        ...details,
        pid: process.pid,
        ppid: process.ppid,
        stack: stackSummary(),
    })}`)
}
