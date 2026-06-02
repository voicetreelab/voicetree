import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {matchClaudeSessionId, type ClaudeTranscriptRecord} from './claude-transcript-matcher'

export type ResolveClaudeRequest = {
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
    readonly recencyWindowMs?: number
    readonly scanTimeoutMs?: number
}

/**
 * Discriminant explaining a Claude native-session resolver miss.
 *
 * - `projects-dir-missing`   — `~/.claude/projects` does not exist
 * - `no-jsonl-matches`       — no transcript carries our markers, in or out of window
 * - `outside-recency-window` — our transcript exists but its mtime is older than the window
 * - `marker-mismatch`        — in-window JSONLs were scanned but none contained all three VoiceTree markers
 * - `scan-timeout`           — scan exceeded its time budget before completing
 */
export type ClaudeMissReason =
    | 'projects-dir-missing'
    | 'no-jsonl-matches'
    | 'outside-recency-window'
    | 'marker-mismatch'
    | 'scan-timeout'

export type ResolveClaudeResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath: string}
    | {readonly kind: 'not-found'; readonly reason: ClaudeMissReason; readonly diagnosticSessionId?: string}

export type ClaudeTranscriptsList =
    | {readonly kind: 'transcripts'; readonly paths: readonly string[]}
    | {readonly kind: 'projects-dir-missing'}

export type ResolveClaudeDeps = {
    readonly listProjectTranscripts: () => ClaudeTranscriptsList
    readonly fileModifiedAt: (filePath: string) => number       // epoch ms
    readonly readJsonlLines: (filePath: string) => readonly ClaudeTranscriptRecord[]
    readonly now: () => number                                  // epoch ms
}

const DEFAULT_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_SCAN_TIMEOUT_MS = 10 * 1000

type ScanCandidate = {readonly path: string; readonly mtime: number}

type ScanOutcome =
    | {readonly kind: 'match'; readonly sessionId: string; readonly path: string}
    | {readonly kind: 'no-match'}
    | {readonly kind: 'scan-timeout'}

/**
 * Reads each candidate transcript (newest first) and runs the pure marker
 * matcher, returning the first match. Polls `deadlineMs` between files: a single
 * hung `readFileSync` cannot be preempted, but realistic transcript scans
 * terminate per-file in microseconds, so an O(files) deadline check is
 * sufficient to bound total wall time.
 */
function scanForSession(
    candidates: readonly ScanCandidate[],
    request: ResolveClaudeRequest,
    deps: ResolveClaudeDeps,
    deadlineMs: number,
): ScanOutcome {
    for (const {path: filePath} of candidates) {
        if (deps.now() > deadlineMs) return {kind: 'scan-timeout'}
        const records: readonly ClaudeTranscriptRecord[] = deps.readJsonlLines(filePath)
        const sessionId: string | null = matchClaudeSessionId({
            records,
            terminalId: request.terminalId,
            projectRoot: request.projectRoot,
            taskNodePath: request.taskNodePath,
        })
        if (sessionId) return {kind: 'match', sessionId, path: filePath}
    }
    return {kind: 'no-match'}
}

/**
 * Scans recently-modified Claude transcript files under `~/.claude/projects/**\/*.jsonl`,
 * runs the pure marker matcher over each, returns the first match.
 *
 * Recency filtering happens BEFORE file reads so we never `readFileSync` a transcript
 * older than the window on the common path — large `.claude/projects` trees would
 * otherwise dominate IO.
 *
 * When nothing is in the window, a single unwindowed 2nd pass scans the
 * remaining (older) transcripts — mirroring the Codex resolver — so an
 * out-of-window match still yields an actionable `outside-recency-window` miss
 * carrying `diagnosticSessionId`, letting the UI offer a copy-`claude --resume
 * <id>` escape hatch instead of a dead-end `no-jsonl-matches`. Both passes share
 * the same `scan-timeout` deadline, which also bounds the unwindowed pass.
 */
export async function resolveClaudeNativeSession(
    request: ResolveClaudeRequest,
    deps: ResolveClaudeDeps = defaultResolveClaudeDeps(),
): Promise<ResolveClaudeResult> {
    const recencyWindowMs: number = request.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
    const scanTimeoutMs: number = request.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS
    const startMs: number = deps.now()
    const deadlineMs: number = startMs + scanTimeoutMs
    const cutoff: number = startMs - recencyWindowMs

    const list: ClaudeTranscriptsList = deps.listProjectTranscripts()
    if (list.kind === 'projects-dir-missing') return {kind: 'not-found', reason: 'projects-dir-missing'}

    const byMtimeDesc = (a: ScanCandidate, b: ScanCandidate): number => b.mtime - a.mtime
    const all: ScanCandidate[] = list.paths.map((filePath) => ({path: filePath, mtime: deps.fileModifiedAt(filePath)}))
    const recent: ScanCandidate[] = all.filter((c) => c.mtime >= cutoff).sort(byMtimeDesc)

    if (recent.length === 0) {
        const outOfWindow: ScanCandidate[] = [...all].sort(byMtimeDesc)
        if (outOfWindow.length === 0) return {kind: 'not-found', reason: 'no-jsonl-matches'}
        const diagnostic: ScanOutcome = scanForSession(outOfWindow, request, deps, deadlineMs)
        if (diagnostic.kind === 'scan-timeout') return {kind: 'not-found', reason: 'scan-timeout'}
        return diagnostic.kind === 'match'
            ? {kind: 'not-found', reason: 'outside-recency-window', diagnosticSessionId: diagnostic.sessionId}
            : {kind: 'not-found', reason: 'no-jsonl-matches'}
    }

    const outcome: ScanOutcome = scanForSession(recent, request, deps, deadlineMs)
    if (outcome.kind === 'scan-timeout') return {kind: 'not-found', reason: 'scan-timeout'}
    return outcome.kind === 'match'
        ? {kind: 'found', sessionId: outcome.sessionId, providerStorePath: outcome.path}
        : {kind: 'not-found', reason: 'marker-mismatch'}
}

function listJsonlFilesRecursive(root: string): readonly string[] {
    const results: string[] = []
    let entries: readonly string[]
    try {
        entries = readdirSync(root)
    } catch {
        return []
    }
    for (const entry of entries) {
        const full: string = path.join(root, entry)
        let stat
        try {
            stat = statSync(full)
        } catch {
            continue
        }
        if (stat.isDirectory()) {
            results.push(...listJsonlFilesRecursive(full))
        } else if (stat.isFile() && entry.endsWith('.jsonl')) {
            results.push(full)
        }
    }
    return results
}

function safeFileModifiedAt(filePath: string): number {
    try {
        return statSync(filePath).mtimeMs
    } catch {
        return 0
    }
}

function safeReadJsonlLines(filePath: string): readonly ClaudeTranscriptRecord[] {
    let raw: string
    try {
        raw = readFileSync(filePath, 'utf8')
    } catch {
        return []
    }
    const records: ClaudeTranscriptRecord[] = []
    for (const line of raw.split('\n')) {
        const trimmed: string = line.trim()
        if (!trimmed) continue
        try {
            records.push(JSON.parse(trimmed) as ClaudeTranscriptRecord)
        } catch {
            // Skip malformed lines; transcripts can have partial trailing writes.
        }
    }
    return records
}

export function defaultResolveClaudeDeps(
    projectsRoot: string = path.join(os.homedir(), '.claude', 'projects'),
): ResolveClaudeDeps {
    return {
        listProjectTranscripts: (): ClaudeTranscriptsList => {
            if (!existsSync(projectsRoot)) return {kind: 'projects-dir-missing'}
            return {kind: 'transcripts', paths: listJsonlFilesRecursive(projectsRoot)}
        },
        fileModifiedAt: safeFileModifiedAt,
        readJsonlLines: safeReadJsonlLines,
        now: () => Date.now(),
    }
}
