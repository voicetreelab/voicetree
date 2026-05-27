import {getRecoveryEnv, getRuntimeEnv, type RecoveryEnv} from '@vt/agent-runtime/runtime/runtime-config'
import {getTerminalRecords, type TerminalRecord} from '@vt/agent-runtime/terminals/terminal-registry/index.ts'
import {getRecoveryMetadataDir} from '../paths'

/**
 * Discriminated result for `removePersistedAgentRecord`.
 *
 * `removed` — JSON (and any sibling artifacts that existed) are gone from disk.
 *   Idempotent: a missing JSON is treated as "already removed" and returns
 *   `removed`, since the observable end state matches what the caller wanted.
 *
 * `refused` — the operation was rejected for a structural reason. Currently:
 *   - `live-registry-entry`: the id is in the live in-memory terminal registry
 *     (deleting it would orphan a running agent's view of its own metadata).
 *   - `no-project-root`: the runtime env has no project root available, so
 *     there is no canonical metadata dir to unlink from. The renderer should
 *     never hit this in normal flow (vault must be open to see the row).
 *
 * `invalid-id` — the terminal id failed strict-allowlist validation. Returned
 *   for path-traversal attempts (`../foo`), shell-special chars, empties, etc.
 */
export type RemovePersistedAgentRecordResult =
    | {readonly kind: 'removed'}
    | {readonly kind: 'refused'; readonly reason: 'live-registry-entry' | 'no-project-root'}
    | {readonly kind: 'invalid-id'}

export type RemovePersistedAgentRecordDeps = {
    readonly getProjectRoot: () => Promise<string | null>
    readonly isInLiveRegistry: (terminalId: string) => boolean
}

/**
 * Strict allowlist matching the design-doc requirement. Any character outside
 * this set is rejected outright — including `/`, `\`, `.`, whitespace, and any
 * non-ASCII letter. The downstream path is built by `env.path.join` over a
 * validated id; an id like `../foo` would escape the metadata dir, so the
 * regex is the only place this is allowed to fail.
 */
const SAFE_TERMINAL_ID_REGEX: RegExp = /^[A-Za-z0-9_-]+$/

const SIBLING_SUFFIXES: readonly string[] = ['.json', '.log', '-prompt.txt', '.exitcode']

/**
 * Deep function: permanently delete a persisted recovery record's on-disk
 * artifacts, refusing to act on live or unsafe inputs.
 *
 * Validation order is load-bearing:
 *   1. Regex-validate the id (so a malicious caller cannot reach `unlink` with
 *      `../foo` even if the registry/env probes have side effects).
 *   2. Refuse live entries (deleting metadata for a running agent would
 *      desync the registry from disk).
 *   3. Resolve the canonical metadata dir; bail if no projectRoot.
 *   4. Verify the candidate paths canonicalise to a child of the metadata
 *      dir — defence in depth against any future regex slip.
 *   5. Best-effort unlink each sibling, swallowing ENOENT (idempotent).
 *
 * Side-effect surface: `env.fs.unlink` is the only impure call. The deps
 * shape keeps tests black-box: callers stub `getProjectRoot` and
 * `isInLiveRegistry` and provide an env whose `unlink` records the paths it
 * receives.
 */
export async function removePersistedAgentRecordWithEnv(
    env: RecoveryEnv,
    terminalId: string,
    deps?: Partial<RemovePersistedAgentRecordDeps>,
): Promise<RemovePersistedAgentRecordResult> {
    if (!SAFE_TERMINAL_ID_REGEX.test(terminalId)) return {kind: 'invalid-id'}

    const resolved: RemovePersistedAgentRecordDeps = {
        ...defaultRemovePersistedAgentRecordDeps(),
        ...deps,
    }

    if (resolved.isInLiveRegistry(terminalId)) {
        return {kind: 'refused', reason: 'live-registry-entry'}
    }

    const projectRoot: string | null = await resolved.getProjectRoot()
    if (!projectRoot) {
        return {kind: 'refused', reason: 'no-project-root'}
    }

    const metadataDir: string = getRecoveryMetadataDir(projectRoot)
    const canonicalDir: string = env.path.resolve(metadataDir)

    for (const suffix of SIBLING_SUFFIXES) {
        const candidate: string = env.path.join(metadataDir, `${terminalId}${suffix}`)
        const canonical: string = env.path.resolve(candidate)
        // Belt-and-braces: even though the regex already excludes `/`, `\`,
        // and `..`, verify the resolved path is inside the metadata dir.
        // Anything outside is silently skipped (never thrown — refusal should
        // be surfaced by the regex check, this is just defence in depth).
        const withinDir: boolean = canonical === env.path.join(canonicalDir, `${terminalId}${suffix}`)
        if (!withinDir) continue
        try {
            await env.fs.unlink(canonical)
        } catch (error) {
            if (!isFileNotFoundError(error)) throw error
        }
    }

    return {kind: 'removed'}
}

/**
 * Convenience binding: pulls the recovery env from the configured runtime and
 * dispatches. Used by the api/agent-runtime-api.ts re-export surface so the
 * Electron + MCP boot paths don't need env threading yet.
 *
 * Callers that already hold a `RecoveryEnv` should call
 * `removePersistedAgentRecordWithEnv(env, terminalId, deps)` directly.
 */
export async function removePersistedAgentRecord(
    terminalId: string,
    deps?: Partial<RemovePersistedAgentRecordDeps>,
): Promise<RemovePersistedAgentRecordResult> {
    return removePersistedAgentRecordWithEnv(getRecoveryEnv(), terminalId, deps)
}

function isFileNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const code: unknown = (error as {code?: unknown}).code
    return code === 'ENOENT'
}

export function defaultRemovePersistedAgentRecordDeps(): RemovePersistedAgentRecordDeps {
    return {
        getProjectRoot: async (): Promise<string | null> => {
            const probe: (() => Promise<string | null>) | undefined = getRuntimeEnv().getProjectRoot
            return probe ? probe() : null
        },
        isInLiveRegistry: (terminalId: string): boolean => {
            const records: readonly TerminalRecord[] = getTerminalRecords()
            return records.some((record: TerminalRecord): boolean => record.terminalId === terminalId)
        },
    }
}
