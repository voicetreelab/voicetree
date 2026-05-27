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

// Slice C absorbed into @vt/vt-daemon (2026-05-27):
//   completion, recovery, headless, hooks, inject → @vt/vt-daemon/agents/...
// Consumers must import those symbols directly from the daemon's deep paths.

export * from '../application/spawn/spawnHookTerminal'
export * from '../application/spawn/spawnPlainTerminal'
export * from '../application/spawn/spawnTerminalWithContextNode'
export * from '../application/spawn/buildTerminalEnvVars'
