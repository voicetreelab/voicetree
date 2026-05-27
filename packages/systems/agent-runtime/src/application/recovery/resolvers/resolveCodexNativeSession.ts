import type {RecoveryEnv} from '@vt/agent-runtime/runtime/runtime-config'
import {matchCodexThreadId, type CodexThreadRow} from './codex-thread-matcher'

type ResolveCodexRequest = {
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

type CodexQueryResult =
    | {readonly kind: 'rows'; readonly rows: readonly CodexThreadRow[]}
    | {readonly kind: 'db-missing'}
    | {readonly kind: 'db-schema-mismatch'}

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
    env: RecoveryEnv,
    request: ResolveCodexRequest,
): ResolveCodexResult {
    const dbPath: string = env.recoveryConfig.codexStateDb
    const recencyWindowMs: number = request.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS
    const rowLimit: number = request.rowLimit ?? DEFAULT_ROW_LIMIT
    const sinceMs: number = env.now() - recencyWindowMs

    const recent: CodexQueryResult = queryRows(env, dbPath, {limit: rowLimit, sinceMs})
    if (recent.kind === 'db-missing') return {kind: 'not-found', reason: 'db-missing'}
    if (recent.kind === 'db-schema-mismatch') return {kind: 'not-found', reason: 'db-schema-mismatch'}

    if (recent.rows.length === 0) {
        const any: CodexQueryResult = queryRows(env, dbPath, {limit: rowLimit})
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

function queryRows(env: RecoveryEnv, dbPath: string, opts: {readonly limit: number; readonly sinceMs?: number}): CodexQueryResult {
    const result = env.sqlite.queryCodexThreads(dbPath, opts)
    if (result.kind !== 'rows') return result
    return {kind: 'rows', rows: result.rows.map(toCodexThreadRow)}
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
