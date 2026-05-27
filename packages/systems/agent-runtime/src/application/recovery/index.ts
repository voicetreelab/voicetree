import type {RecoveryEnv} from '../runtime/runtime-config'
import type {TerminalId} from '../terminals/terminal-registry/types'
import {discoverRecoverableAgentSessions, type DiscoverRecoveryOptions} from './discovery'
import {resumePersistedAgentSession, type ResumePersistedDeps, type ResumePersistedResult} from './sessions/resumePersistedAgentSession'
import {forkAgentSession, type ForkAgentSessionDeps, type ForkAgentSessionResult} from './sessions/forkAgentSession'
import {migrateLegacyTerminalDir, type MigrateLegacyTerminalDirArgs, type MigrateLegacyTerminalDirResult} from './persistence/migrate-legacy-terminal-dir'
import {removePersistedAgentRecord, type RemovePersistedAgentRecordDeps, type RemovePersistedAgentRecordResult} from './persistence/removePersistedAgentRecord'
import type {RecoverableAgentSession} from './types'

/**
 * Deep-function entry to the recovery community.
 *
 * `createRecoveryAPI(env)` binds the `RecoveryEnv` once at the shell and
 * returns a record of operations whose call shape no longer mentions env —
 * callers think in domain terms (`discover`, `resume`, `fork`, `migrate`,
 * `remove`) and the facade hides every `fs`/`path`/`sqlite`/`now`/`config`
 * capability behind that boundary.
 *
 * This is the package-as-deep-function (P2) lift of the per-file M1 pattern:
 * the recovery sibling files (discovery, persistence/*, resolvers/*,
 * sessions/*) all close over a single `RecoveryEnv`, and external callers
 * see exactly one public symbol from this community.
 */
export type RecoveryAPI = {
    readonly discoverRecoverableAgentSessions: (opts?: DiscoverRecoveryOptions) => Promise<readonly RecoverableAgentSession[]>
    readonly resumePersistedAgentSession: (terminalId: TerminalId, deps?: ResumePersistedDeps) => Promise<ResumePersistedResult>
    readonly forkAgentSession: (sourceTerminalId: TerminalId, deps?: ForkAgentSessionDeps) => Promise<ForkAgentSessionResult>
    readonly migrateLegacyTerminalDir: (args: MigrateLegacyTerminalDirArgs) => MigrateLegacyTerminalDirResult
    readonly removePersistedAgentRecord: (terminalId: string, deps?: Partial<RemovePersistedAgentRecordDeps>) => Promise<RemovePersistedAgentRecordResult>
}

export function createRecoveryAPI(env: RecoveryEnv): RecoveryAPI {
    return {
        discoverRecoverableAgentSessions: (opts) => discoverRecoverableAgentSessions(env, opts),
        resumePersistedAgentSession: (terminalId, deps) =>
            deps === undefined
                ? resumePersistedAgentSession(env, terminalId)
                : resumePersistedAgentSession(env, terminalId, deps),
        forkAgentSession: (sourceTerminalId, deps) =>
            deps === undefined
                ? forkAgentSession(env, sourceTerminalId)
                : forkAgentSession(env, sourceTerminalId, deps),
        migrateLegacyTerminalDir: (args) => migrateLegacyTerminalDir(env, args),
        removePersistedAgentRecord: (terminalId, deps) => removePersistedAgentRecord(env, terminalId, deps),
    }
}
