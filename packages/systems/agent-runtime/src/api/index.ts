// Public API surface for @vt/agent-runtime.
// Both Electron (webapp) and vt-mcpd consume runtime functionality through this barrel
// (or via the stable deep paths declared in package.json#exports).

export * from '@vt/vt-daemon/runtime/runtime-config.ts'
export * from './agent-runtime-api'
export * from '@vt/vt-daemon/agent-lifecycle'

// Slice A absorption: terminals / relay / util implementations moved into
// @vt/vt-daemon. Re-export the public symbols transiently so existing barrel
// consumers keep compiling. This creates an agent-runtime -> vt-daemon edge
// that disappears when Slice D retires @vt/agent-runtime entirely.
export * from '@vt/vt-daemon/terminals/terminal-registry/types.ts'
export {TerminalManager} from '@vt/vt-daemon/terminals/manager/terminal-manager.ts'
export type {
    TerminalSpawnResult,
    TerminalOperationResult,
    TerminalSpawnOpts,
} from '@vt/vt-daemon/terminals/manager/terminal-manager.ts'
export * from '@vt/vt-daemon/terminals/manager/terminal-manager-instance.ts'
export * from '@vt/vt-daemon/terminals/terminal-registry'
export * from '@vt/vt-daemon/terminals/terminal-output-buffer.ts'
export * from '@vt/vt-daemon/terminals/global-budget-registry.ts'
export * from '@vt/vt-daemon/terminals/tmux/tmux-preflight.ts'
export * from '@vt/vt-daemon/terminals/tmux/tmux-server.ts'
export * from '@vt/vt-daemon/terminals/tmux/unclaimed-tmux.ts'

// Slice C absorbed into @vt/vt-daemon (2026-05-27):
//   completion, recovery, headless, hooks, inject → @vt/vt-daemon/agents/...
// Consumers must import those symbols directly from the daemon's deep paths.

export * from '@vt/vt-daemon/spawn/spawnHookTerminal.ts'
export * from '@vt/vt-daemon/spawn/spawnPlainTerminal.ts'
export * from '@vt/vt-daemon/spawn/spawnTerminalWithContextNode.ts'
export * from '@vt/vt-daemon/spawn/buildTerminalEnvVars.ts'
