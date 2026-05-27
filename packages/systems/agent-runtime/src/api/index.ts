// Public API surface for @vt/agent-runtime.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through this barrel
// (or via the stable deep paths declared in package.json#exports).

export * from '../application/terminals/terminal-registry/types'
export * from '@vt/vt-daemon/runtime/runtime-config.ts'
export * from './agent-runtime-api'
export * from '@vt/vt-daemon/agent-lifecycle'

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

export * from '../application/headless/headlessAgentManager'

export * from '@vt/vt-daemon/spawn/spawnHookTerminal.ts'
export * from '@vt/vt-daemon/spawn/spawnPlainTerminal.ts'
export * from '@vt/vt-daemon/spawn/spawnTerminalWithContextNode.ts'
export * from '@vt/vt-daemon/spawn/buildTerminalEnvVars.ts'

export * from '../application/hooks/stopGateAudit'
export * from '../application/hooks/stopGateHookRunner'
export * from '../application/hooks/onNewNodeHook'

export * from '../application/inject/get-unseen-nodes-for-terminal'
export * from '../application/inject/inject-nodes-into-terminal'
export * from '../application/inject/send-text-to-terminal'

export {
    registerAgentNodes,
    getAgentNodes,
    clearAgentNodes,
    type AgentNodeEntry,
} from '../application/completion/agentNodeIndex'
export {
    isAgentComplete,
    getAgentStatus,
    NO_PROGRESS_TIMEOUT_MS,
    type AgentStatus,
} from '../application/completion/isAgentComplete'
export {
    buildCompletionMessage,
    type AgentResult,
} from '../application/completion/buildCompletionMessage'
export {
    getNewNodesForAgent,
    getNewNodesForAgentIdentities,
} from '../application/completion/getNewNodesForAgent'
