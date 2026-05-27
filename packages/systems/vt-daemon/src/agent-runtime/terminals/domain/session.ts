import type {TerminalLifecycle} from '@vt/vt-daemon/agent-runtime/lifecycle'
import type {
    TerminalRecord,
    TerminalRegistryClock,
    TerminalRegistryLogger,
    TerminalRegistryRuntime,
    TerminalRegistryTimers,
} from '../terminal-registry-state.ts'

export type {
    TerminalLifecycle,
    TerminalRecord,
    TerminalRegistryClock,
    TerminalRegistryLogger,
    TerminalRegistryRuntime,
    TerminalRegistryTimers,
}

export type TerminalRegistrySnapshot = readonly TerminalRecord[]
