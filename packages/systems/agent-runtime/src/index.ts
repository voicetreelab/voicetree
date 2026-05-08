// Public API surface for @vt/agent-runtime.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through this barrel
// (or via the stable deep paths declared in package.json#exports).

export * from './types'
export * from './runtime-config'
export * from './lifecycle'

export { TerminalManager } from './terminals/terminal-manager'
export type {
    TerminalSpawnResult,
    TerminalOperationResult,
    TerminalSpawnOpts,
} from './terminals/terminal-manager'
export * from './terminals/terminal-manager-instance'
export * from './terminals/terminal-registry'
export * from './terminals/terminal-output-buffer'
export * from './terminals/global-budget-registry'

export * from './headless/headlessAgentManager'

export * from './spawn/spawnHookTerminal'
export * from './spawn/spawnPlainTerminal'
export * from './spawn/spawnTerminalWithContextNode'
export * from './spawn/buildTerminalEnvVars'

export * from './hooks/stopGateAudit'
export * from './hooks/stopGateHookRunner'
export * from './hooks/onNewNodeHook'

export * from './inject/get-unseen-nodes-for-terminal'
export * from './inject/inject-nodes-into-terminal'
export * from './inject/send-text-to-terminal'

export { shellQuote } from './util/shellQuote'
