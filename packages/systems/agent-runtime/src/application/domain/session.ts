import type {TerminalLifecycle} from '@vt/vt-daemon/agent-lifecycle'
import type {
    TerminalRecord,
    TerminalRegistryClock,
    TerminalRegistryLogger,
    TerminalRegistryRuntime,
    TerminalRegistryTimers,
} from '@vt/agent-runtime/terminals/terminal-registry-state.ts'

export type {
    TerminalLifecycle,
    TerminalRecord,
    TerminalRegistryClock,
    TerminalRegistryLogger,
    TerminalRegistryRuntime,
    TerminalRegistryTimers,
}

export type TerminalRegistrySnapshot = readonly TerminalRecord[]
