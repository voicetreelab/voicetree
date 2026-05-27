import type {RecoveryEnv} from '@vt/agent-runtime/runtime/runtime-config'
import {matchClaudeSessionId, type ClaudeTranscriptRecord} from './claude-transcript-matcher'

type ResolveClaudeRequest = {
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
    readonly recencyWindowMs?: number
    readonly scanTimeoutMs?: number
}

/**
 * Discriminant explaining a Claude native-session resolver miss.
 *
 * - `projects-dir-missing` — `~/.claude/projects` does not exist
 * - `no-jsonl-matches`     — no transcript JSONLs survived the recency filter
 * - `marker-mismatch`      — JSONLs were scanned but none contained all three VoiceTree markers
 * - `scan-timeout`         — scan exceeded its time budget before completing
 */
export type ClaudeMissReason =
    | 'projects-dir-missing'
    | 'no-jsonl-matches'
    | 'marker-mismatch'
    | 'scan-timeout'

export type ResolveClaudeResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath: string}
    | {readonly kind: 'not-found'; readonly reason: ClaudeMissReason}

type ClaudeTranscriptsList =
    | {readonly kind: 'transcripts'; readonly paths: readonly string[]}
    | {readonly kind: 'projects-dir-missing'}

const DEFAULT_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_SCAN_TIMEOUT_MS = 10 * 1000

/**
 * Scans recently-modified Claude transcript files under `~/.claude/projects/**\/*.jsonl`,
 * runs the pure marker matcher over each, returns the first match.
 *
 * Recency filtering happens BEFORE file reads so we never `readFileSync` a transcript
 * older than the window — large `.claude/projects` trees would otherwise dominate IO.
 *
 * On miss returns a structured `reason`. `scan-timeout` is enforced via a
 * deadline polled between files; a single hung `readFileSync` cannot be
 * preempted but realistic transcript scans terminate per-file in microseconds,
 * so an O(files) deadline check is sufficient to bound total wall time.
 */
export async function resolveClaudeNativeSession(
    env: RecoveryEnv,
    request: ResolveClaudeRequest,
): Promise<ResolveClaudeResult> {
    const projectsRoot: string = env.recoveryConfig.claudeProjectsDir
    const recencyWindowMs: number = request.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
    const scanTimeoutMs: number = request.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS
    const startMs: number = env.now()
    const deadlineMs: number = startMs + scanTimeoutMs
    const cutoff: number = startMs - recencyWindowMs

    const list: ClaudeTranscriptsList = listProjectTranscripts(env, projectsRoot)
    if (list.kind === 'projects-dir-missing') return {kind: 'not-found', reason: 'projects-dir-missing'}

    const recent: Array<{readonly path: string; readonly mtime: number}> = []
    for (const filePath of list.paths) {
        const mtime: number = fileModifiedAt(env, filePath)
        if (mtime >= cutoff) recent.push({path: filePath, mtime})
    }
    if (recent.length === 0) return {kind: 'not-found', reason: 'no-jsonl-matches'}
    recent.sort((a, b) => b.mtime - a.mtime)

    for (const {path: filePath} of recent) {
        if (env.now() > deadlineMs) return {kind: 'not-found', reason: 'scan-timeout'}
        const records: readonly ClaudeTranscriptRecord[] = parseJsonlLines(env.fs.readFileUtf8(filePath))
        const sessionId: string | null = matchClaudeSessionId({
            records,
            terminalId: request.terminalId,
            projectRoot: request.projectRoot,
            taskNodePath: request.taskNodePath,
        })
        if (sessionId) return {kind: 'found', sessionId, providerStorePath: filePath}
    }
    return {kind: 'not-found', reason: 'marker-mismatch'}
}

function listProjectTranscripts(env: RecoveryEnv, projectsRoot: string): ClaudeTranscriptsList {
    if (!env.fs.existsSync(projectsRoot)) return {kind: 'projects-dir-missing'}
    // env.fs.readdirSync may throw on the root if it disappears between
    // the existsSync check and the walk; defer such races to the caller
    // (resolveClaudeNativeSession returns 'projects-dir-missing' for an
    // absent root, and an empty file list otherwise).
    try {
        return {kind: 'transcripts', paths: listJsonlFilesRecursive(env, projectsRoot)}
    } catch {
        return {kind: 'transcripts', paths: []}
    }
}

function listJsonlFilesRecursive(env: RecoveryEnv, root: string): readonly string[] {
    const results: string[] = []
    const entries: readonly string[] = env.fs.readdirSync(root)
    for (const entry of entries) {
        const full: string = env.path.join(root, entry)
        const stat = env.fs.statSync(full)
        if (!stat) continue
        if (stat.isDirectory()) {
            results.push(...listJsonlFilesRecursive(env, full))
        } else if (stat.isFile() && entry.endsWith('.jsonl')) {
            results.push(full)
        }
    }
    return results
}

function fileModifiedAt(env: RecoveryEnv, filePath: string): number {
    const stat = env.fs.statSync(filePath)
    return stat ? stat.mtimeMs : 0
}

function parseJsonlLines(raw: string): readonly ClaudeTranscriptRecord[] {
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
