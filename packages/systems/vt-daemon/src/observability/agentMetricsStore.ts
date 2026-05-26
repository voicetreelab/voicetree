// BF-382 · Phase 3 — daemon-side agent-metrics persistence.
//
// Relocates the per-session token/cost telemetry store from Electron Main
// (`webapp/.../agent-metrics-store.ts`) into the daemon, with one structural
// change: the file moves from `<userData>/agent_metrics.json` (per-user, all
// vaults co-mingled) to `<vault>/.voicetree/agent_metrics.json` (per-vault).
// The C4 principle requires that anything VTD owns is reachable identically
// by every client; per-user storage tied agents to the host process and
// hid them from CLI peers reaching the same vault.
//
// Functional design:
//   - Public API is narrow: `appendTokenMetrics`, `getSessions`. Both take
//     `vault` explicitly — no module-level globals, no setVault coupling.
//   - Pure helpers (`isValidSession`, `extractValidSessions`) do parsing /
//     validation against `unknown` inputs.
//   - Impure shell (`readMetrics`, `writeMetrics`) isolates file I/O. The
//     write is atomic via temp+rename to match the existing pattern at
//     `webapp/.../agent-metrics-store.ts:96`.
//
// Same-sessionId double-append semantics match the prior Main-side impl
// (`agent-metrics-store.ts:120`): a second append updates the existing
// entry's tokens / cost / durationMs rather than pushing a duplicate.

import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'

import {VOICETREE_DIRNAME} from '@vt/vt-rpc'

export interface TokenMetrics {
    readonly input: number
    readonly output: number
    readonly cacheRead?: number
}

export interface SessionMetric {
    readonly sessionId: string
    readonly agentName: string
    readonly contextNode: string
    readonly startTime: string
    readonly endTime?: string
    readonly durationMs?: number
    readonly tokens?: TokenMetrics
    readonly costUsd?: number
}

export interface AgentMetricsData {
    readonly sessions: readonly SessionMetric[]
}

export const AGENT_METRICS_FILENAME: string = 'agent_metrics.json'

function metricsFilePath(vault: string): string {
    return join(resolve(vault), VOICETREE_DIRNAME, AGENT_METRICS_FILENAME)
}

function isValidSession(session: unknown): session is SessionMetric {
    if (!session || typeof session !== 'object') return false
    const s: Record<string, unknown> = session as Record<string, unknown>
    return (
        typeof s.sessionId === 'string'
        && typeof s.agentName === 'string'
        && typeof s.contextNode === 'string'
        && typeof s.startTime === 'string'
    )
}

function extractValidSessions(parsed: unknown): SessionMetric[] {
    if (!parsed || typeof parsed !== 'object') return []

    let rawSessions: unknown[] = []
    if ('sessions' in parsed && Array.isArray((parsed as {sessions: unknown}).sessions)) {
        rawSessions = (parsed as {sessions: unknown[]}).sessions
    } else if (Array.isArray(parsed)) {
        rawSessions = parsed
    }

    const validSessions: SessionMetric[] = []
    let invalidCount: number = 0
    for (const session of rawSessions) {
        if (isValidSession(session)) {
            validSessions.push(session)
        } else {
            invalidCount++
        }
    }
    if (invalidCount > 0) {
        process.stderr.write(
            `[agentMetricsStore] Discarded ${invalidCount} invalid session(s), `
            + `kept ${validSessions.length} valid session(s)\n`,
        )
    }
    return validSessions
}

async function readMetrics(vault: string): Promise<{readonly sessions: SessionMetric[]}> {
    const path: string = metricsFilePath(vault)
    try {
        const text: string = await readFile(path, 'utf-8')
        const parsed: unknown = JSON.parse(text)
        return {sessions: extractValidSessions(parsed)}
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {sessions: []}
        if (cause instanceof SyntaxError) {
            process.stderr.write(
                `[agentMetricsStore] Invalid JSON at ${path}: ${cause.message}\n`,
            )
            return {sessions: []}
        }
        throw cause
    }
}

async function writeMetrics(
    vault: string,
    data: {readonly sessions: readonly SessionMetric[]},
): Promise<void> {
    const path: string = metricsFilePath(vault)
    const tempPath: string = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), {recursive: true})
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8')
    await rename(tempPath, path)
}

export async function getSessions(vault: string): Promise<readonly SessionMetric[]> {
    const {sessions} = await readMetrics(vault)
    return sessions
}

export async function appendTokenMetrics(
    vault: string,
    sessionId: string,
    tokens: TokenMetrics,
    costUsd: number,
): Promise<void> {
    const {sessions: prior}: {sessions: SessionMetric[]} = await readMetrics(vault)
    const updated: SessionMetric[] = [...prior]
    const existingIdx: number = updated.findIndex(
        (s: SessionMetric): boolean => s.sessionId === sessionId,
    )

    const existing: SessionMetric | undefined = existingIdx >= 0 ? updated[existingIdx] : undefined
    const startTime: string = existing?.startTime ?? new Date().toISOString()
    const endTime: string | undefined = existing?.endTime
    const durationMs: number = endTime !== undefined
        ? existing?.durationMs ?? 0
        : Date.now() - new Date(startTime).getTime()

    const merged: SessionMetric = {
        sessionId,
        // Auto-created sessions (OTLP from Claude Code, which uses its own
        // session ids rather than Voicetree terminal ids) get a default
        // identity; preserve any existing terminal-registered metadata.
        agentName: existing?.agentName ?? 'Claude',
        contextNode: existing?.contextNode ?? 'unknown',
        startTime,
        ...(endTime !== undefined ? {endTime} : {}),
        durationMs,
        tokens,
        costUsd,
    }

    if (existingIdx >= 0) {
        updated[existingIdx] = merged
    } else {
        updated.push(merged)
    }
    await writeMetrics(vault, {sessions: updated})
}
