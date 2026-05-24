import {DatabaseSync} from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'
import {matchCodexThreadId, type CodexThreadRow} from './codex-thread-matcher'

export type ResolveCodexRequest = {
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
    readonly recencyWindowMs?: number
    readonly rowLimit?: number
}

export type ResolveCodexResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath?: string}
    | {readonly kind: 'not-found'}

export type ResolveCodexDeps = {
    readonly listRecentThreads: (sinceMs: number, limit: number) => readonly CodexThreadRow[]
    readonly now: () => number
}

const DEFAULT_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_ROW_LIMIT = 200

/**
 * Resolves the Codex `threads.id` for a VoiceTree-spawned agent by reading
 * `~/.codex/state_5.sqlite` for recent rows and running the pure marker matcher.
 *
 * Recency window and limit are deliberately wide enough to catch sessions that
 * may have been spawned hours earlier but not yet had a follow-up message.
 */
export function resolveCodexNativeSession(
    request: ResolveCodexRequest,
    deps: ResolveCodexDeps = defaultResolveCodexDeps(),
): ResolveCodexResult {
    const recencyWindowMs: number = request.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
    const rowLimit: number = request.rowLimit ?? DEFAULT_ROW_LIMIT
    const sinceMs: number = deps.now() - recencyWindowMs
    const rows: readonly CodexThreadRow[] = deps.listRecentThreads(sinceMs, rowLimit)
    const sessionId: string | null = matchCodexThreadId({
        rows,
        terminalId: request.terminalId,
        projectRoot: request.projectRoot,
        taskNodePath: request.taskNodePath,
    })
    if (!sessionId) return {kind: 'not-found'}
    const matched: CodexThreadRow | undefined = rows.find((row) => row.id === sessionId)
    const providerStorePath: string | undefined = matched?.rollout_path
    return providerStorePath
        ? {kind: 'found', sessionId, providerStorePath}
        : {kind: 'found', sessionId}
}

function openCodexDb(dbPath: string): DatabaseSync | null {
    try {
        return new DatabaseSync(dbPath, {readOnly: true})
    } catch {
        return null
    }
}

export function defaultResolveCodexDeps(
    dbPath: string = path.join(os.homedir(), '.codex', 'state_5.sqlite'),
): ResolveCodexDeps {
    return {
        listRecentThreads: (sinceMs: number, limit: number): readonly CodexThreadRow[] => {
            const db: DatabaseSync | null = openCodexDb(dbPath)
            if (!db) return []
            try {
                const stmt = db.prepare(
                    'SELECT id, first_user_message, cwd, created_at_ms, updated_at_ms, rollout_path '
                    + 'FROM threads WHERE updated_at_ms >= ? ORDER BY updated_at_ms DESC LIMIT ?',
                )
                const raw = stmt.all(sinceMs, limit) as readonly Record<string, unknown>[]
                return raw.map(toCodexThreadRow)
            } catch {
                return []
            } finally {
                try {
                    db.close()
                } catch {
                    // ignore
                }
            }
        },
        now: () => Date.now(),
    }
}

function toCodexThreadRow(raw: Record<string, unknown>): CodexThreadRow {
    return {
        id: String(raw.id ?? ''),
        first_user_message: typeof raw.first_user_message === 'string' ? raw.first_user_message : undefined,
        cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        created_at_ms: typeof raw.created_at_ms === 'number' ? raw.created_at_ms : undefined,
        updated_at_ms: typeof raw.updated_at_ms === 'number' ? raw.updated_at_ms : undefined,
        rollout_path: typeof raw.rollout_path === 'string' ? raw.rollout_path : undefined,
    }
}
