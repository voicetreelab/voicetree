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

/**
 * Discriminant explaining a Codex native-session resolver miss.
 *
 * - `db-missing`              — `~/.codex/state_5.sqlite` cannot be opened
 * - `db-schema-mismatch`      — the `threads` table or its expected columns are absent
 * - `no-rows`                 — `threads` is empty in both the recency window and the full table
 * - `outside-recency-window`  — our thread exists but its `updated_at_ms` is older than the window
 * - `marker-mismatch`         — recent rows exist but none carry all three VoiceTree markers
 */
export type CodexMissReason =
    | 'db-missing'
    | 'db-schema-mismatch'
    | 'no-rows'
    | 'outside-recency-window'
    | 'marker-mismatch'

export type ResolveCodexResult =
    | {readonly kind: 'found'; readonly sessionId: string; readonly providerStorePath?: string}
    | {readonly kind: 'not-found'; readonly reason: CodexMissReason; readonly diagnosticSessionId?: string}

export type CodexQueryResult =
    | {readonly kind: 'rows'; readonly rows: readonly CodexThreadRow[]}
    | {readonly kind: 'db-missing'}
    | {readonly kind: 'db-schema-mismatch'}

export type ResolveCodexDeps = {
    readonly listRecentThreads: (sinceMs: number, limit: number) => CodexQueryResult
    readonly listAnyThreads: (limit: number) => CodexQueryResult
    readonly now: () => number
}

const DEFAULT_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_ROW_LIMIT = 200

/**
 * Resolves the Codex `threads.id` for a VoiceTree-spawned agent by reading
 * `~/.codex/state_5.sqlite` for recent rows and running the pure marker matcher.
 *
 * On miss returns a structured `reason`:
 *  - `db-missing` / `db-schema-mismatch` from the DB query layer.
 *  - `marker-mismatch` when rows exist in the window but none carry our markers.
 *  - `no-rows` vs `outside-recency-window`: when the windowed query returns 0
 *    rows we run a second query without the time predicate. If it matches our
 *    markers we report `outside-recency-window` plus `diagnosticSessionId` so
 *    the UI can offer a manual `codex resume <id>` copy command.
 */
export function resolveCodexNativeSession(
    request: ResolveCodexRequest,
    deps: ResolveCodexDeps = defaultResolveCodexDeps(),
): ResolveCodexResult {
    const recencyWindowMs: number = request.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
    const rowLimit: number = request.rowLimit ?? DEFAULT_ROW_LIMIT
    const sinceMs: number = deps.now() - recencyWindowMs

    const recent: CodexQueryResult = deps.listRecentThreads(sinceMs, rowLimit)
    if (recent.kind === 'db-missing') return {kind: 'not-found', reason: 'db-missing'}
    if (recent.kind === 'db-schema-mismatch') return {kind: 'not-found', reason: 'db-schema-mismatch'}

    if (recent.rows.length === 0) {
        const any: CodexQueryResult = deps.listAnyThreads(rowLimit)
        if (any.kind === 'db-missing') return {kind: 'not-found', reason: 'db-missing'}
        if (any.kind === 'db-schema-mismatch') return {kind: 'not-found', reason: 'db-schema-mismatch'}
        if (any.rows.length === 0) return {kind: 'not-found', reason: 'no-rows'}
        const diagnosticId: string | null = matchCodexThreadId({
            rows: any.rows,
            terminalId: request.terminalId,
            projectRoot: request.projectRoot,
            taskNodePath: request.taskNodePath,
        })
        return diagnosticId
            ? {kind: 'not-found', reason: 'outside-recency-window', diagnosticSessionId: diagnosticId}
            : {kind: 'not-found', reason: 'no-rows'}
    }

    const sessionId: string | null = matchCodexThreadId({
        rows: recent.rows,
        terminalId: request.terminalId,
        projectRoot: request.projectRoot,
        taskNodePath: request.taskNodePath,
    })
    if (!sessionId) return {kind: 'not-found', reason: 'marker-mismatch'}
    const matched: CodexThreadRow | undefined = recent.rows.find((row) => row.id === sessionId)
    const providerStorePath: string | undefined = matched?.rollout_path
    return providerStorePath
        ? {kind: 'found', sessionId, providerStorePath}
        : {kind: 'found', sessionId}
}

function queryCodexThreads(dbPath: string, opts: {limit: number; sinceMs?: number}): CodexQueryResult {
    let db: DatabaseSync
    try {
        db = new DatabaseSync(dbPath, {readOnly: true})
    } catch {
        return {kind: 'db-missing'}
    }
    try {
        const baseColumns = 'id, first_user_message, cwd, created_at_ms, updated_at_ms, rollout_path'
        const sql: string = opts.sinceMs !== undefined
            ? `SELECT ${baseColumns} FROM threads WHERE updated_at_ms >= ? ORDER BY updated_at_ms DESC LIMIT ?`
            : `SELECT ${baseColumns} FROM threads ORDER BY updated_at_ms DESC LIMIT ?`
        let raw: readonly Record<string, unknown>[]
        try {
            const stmt = db.prepare(sql)
            raw = (opts.sinceMs !== undefined
                ? stmt.all(opts.sinceMs, opts.limit)
                : stmt.all(opts.limit)) as readonly Record<string, unknown>[]
        } catch {
            return {kind: 'db-schema-mismatch'}
        }
        return {kind: 'rows', rows: raw.map(toCodexThreadRow)}
    } finally {
        try {
            db.close()
        } catch {
            // ignore
        }
    }
}

export function defaultResolveCodexDeps(
    dbPath: string = path.join(os.homedir(), '.codex', 'state_5.sqlite'),
): ResolveCodexDeps {
    return {
        listRecentThreads: (sinceMs: number, limit: number): CodexQueryResult =>
            queryCodexThreads(dbPath, {sinceMs, limit}),
        listAnyThreads: (limit: number): CodexQueryResult =>
            queryCodexThreads(dbPath, {limit}),
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
