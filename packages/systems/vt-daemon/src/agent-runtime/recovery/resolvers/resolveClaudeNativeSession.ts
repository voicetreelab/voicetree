import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {matchClaudeSessionId, type ClaudeTranscriptRecord} from './claude-transcript-matcher'

export type ResolveClaudeRequest = {
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
    readonly recencyWindowMs?: number
}

export type ResolveClaudeResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath: string}
    | {readonly kind: 'not-found'}

export type ResolveClaudeDeps = {
    readonly listProjectTranscripts: () => readonly string[]   // absolute paths to *.jsonl files
    readonly fileModifiedAt: (filePath: string) => number       // epoch ms
    readonly readJsonlLines: (filePath: string) => readonly ClaudeTranscriptRecord[]
    readonly now: () => number                                  // epoch ms
}

const DEFAULT_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Scans recently-modified Claude transcript files under `~/.claude/projects/**\/*.jsonl`,
 * runs the pure marker matcher over each, returns the first match.
 *
 * Recency filtering happens BEFORE file reads so we never `readFileSync` a transcript
 * older than the window — large `.claude/projects` trees would otherwise dominate IO.
 */
export function resolveClaudeNativeSession(
    request: ResolveClaudeRequest,
    deps: ResolveClaudeDeps = defaultResolveClaudeDeps(),
): ResolveClaudeResult {
    const recencyWindowMs: number = request.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
    const cutoff: number = deps.now() - recencyWindowMs
    const candidates: readonly string[] = deps.listProjectTranscripts()
    const recent: Array<{readonly path: string; readonly mtime: number}> = []
    for (const filePath of candidates) {
        const mtime: number = deps.fileModifiedAt(filePath)
        if (mtime >= cutoff) recent.push({path: filePath, mtime})
    }
    recent.sort((a, b) => b.mtime - a.mtime)
    for (const {path: filePath} of recent) {
        const records: readonly ClaudeTranscriptRecord[] = deps.readJsonlLines(filePath)
        const sessionId: string | null = matchClaudeSessionId({
            records,
            terminalId: request.terminalId,
            projectRoot: request.projectRoot,
            taskNodePath: request.taskNodePath,
        })
        if (sessionId) return {kind: 'found', sessionId, providerStorePath: filePath}
    }
    return {kind: 'not-found'}
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

export function defaultResolveClaudeDeps(projectsRoot: string = path.join(os.homedir(), '.claude', 'projects')): ResolveClaudeDeps {
    return {
        listProjectTranscripts: () => listJsonlFilesRecursive(projectsRoot),
        fileModifiedAt: safeFileModifiedAt,
        readJsonlLines: safeReadJsonlLines,
        now: () => Date.now(),
    }
}
