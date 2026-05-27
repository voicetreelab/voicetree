// Public API surface for @vt/agent-runtime.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through this barrel
// (or via the stable deep paths declared in package.json#exports).

export * from '../application/runtime/runtime-config'
export * from './agent-runtime-api'
export * from '../application/lifecycle'

// Slice A absorption: terminals / relay / util implementations moved into
// @vt/vt-daemon. Re-export the public symbols transiently so existing barrel
// consumers keep compiling. This creates an agent-runtime -> vt-daemon edge
// that disappears when Slice D retires @vt/agent-runtime entirely.
export * from '@vt/vt-daemon/terminals/terminal-registry/types'
export {TerminalManager} from '@vt/vt-daemon/terminals/manager/terminal-manager'
export type {
    TerminalSpawnResult,
    TerminalOperationResult,
    TerminalSpawnOpts,
} from '@vt/vt-daemon/terminals/manager/terminal-manager'
export * from '@vt/vt-daemon/terminals/manager/terminal-manager-instance'
export * from '@vt/vt-daemon/terminals/terminal-registry'
export * from '@vt/vt-daemon/terminals/terminal-output-buffer'
export * from '@vt/vt-daemon/terminals/global-budget-registry'
export * from '@vt/vt-daemon/terminals/tmux/tmux-preflight'
export * from '@vt/vt-daemon/terminals/tmux/tmux-server'
export * from '@vt/vt-daemon/terminals/tmux/unclaimed-tmux'

export * from '../application/recovery/types'
export {discoverRecoverableAgentSessions, defaultDiscoverRecoveryDeps, type DiscoverRecoveryDeps} from '../application/recovery/discovery'
export {resumePersistedAgentSession, defaultResumePersistedDeps, type ResumePersistedDeps, type ResumePersistedResult} from '../application/recovery/resumePersistedAgentSession'
export {forkAgentSession, defaultForkAgentDeps, type ForkAgentSessionDeps, type ForkAgentSessionResult} from '../application/recovery/forkAgentSession'

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
