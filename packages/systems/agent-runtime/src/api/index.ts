// Public API surface for @vt/agent-runtime.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through this barrel
// (or via the stable deep paths declared in package.json#exports).

export * from '../application/terminals/terminal-registry/types'
export * from '../application/runtime/runtime-config'
export * from './agent-runtime-api'
export * from '../application/lifecycle'

export { TerminalManager } from '../application/terminals/terminal-manager'
export type {
    TerminalSpawnResult,
    TerminalOperationResult,
    TerminalSpawnOpts,
} from '../application/terminals/terminal-manager'
export * from '../application/terminals/terminal-manager-instance'
export * from '../application/terminals/terminal-registry'
export * from '../application/terminals/terminal-output-buffer'
export * from '../application/terminals/global-budget-registry'
export * from '../application/terminals/tmux/tmux-preflight'
export * from '../application/terminals/tmux/tmux-server'
export * from '../application/terminals/tmux/unclaimed-tmux'

export * from '../application/recovery/types'
export {discoverRecoverableAgentSessions, defaultDiscoverRecoveryDeps, type DiscoverRecoveryDeps} from '../application/recovery/discovery'
export {resumePersistedAgentSession, defaultResumePersistedDeps, type ResumePersistedDeps, type ResumePersistedResult} from '../application/recovery/resumePersistedAgentSession'
export {forkAgentSession, defaultForkAgentDeps, type ForkAgentSessionDeps, type ForkAgentSessionResult} from '../application/recovery/forkAgentSession'
export {
    migrateLegacyTerminalDir,
    type MigrateLegacyTerminalDirArgs,
    type MigrateLegacyTerminalDirResult,
} from '../application/recovery/migrate-legacy-terminal-dir'
export {
    removePersistedAgentRecord,
    defaultRemovePersistedAgentRecordDeps,
    type RemovePersistedAgentRecordDeps,
    type RemovePersistedAgentRecordResult,
} from '../application/recovery/removePersistedAgentRecord'

export * from '../application/headless/headlessAgentManager'

export * from '../application/spawn/spawnHookTerminal'
export * from '../application/spawn/spawnPlainTerminal'
export * from '../application/spawn/spawnTerminalWithContextNode'
export * from '../application/spawn/buildTerminalEnvVars'

export * from '../application/hooks/stopGateAudit'
export * from '../application/hooks/stopGateHookRunner'
export * from '../application/hooks/onNewNodeHook'

export * from '../application/inject/get-unseen-nodes-for-terminal'
export * from '../application/inject/inject-nodes-into-terminal'
export * from '../application/inject/send-text-to-terminal'
