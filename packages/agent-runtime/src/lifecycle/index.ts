/**
 * Public API surface for the terminal lifecycle module.
 *
 * Pure types + derive function. No I/O — edge code (PTY, hook server,
 * terminal emulator) feeds events into `derive`; consumers read the
 * `lifecycle` field of the resulting state.
 */

export type {
    TerminalLifecycle,
    TerminalKillReason,
    AgentEventKind,
    TerminalEvent,
    TerminalSignalState,
    DeriveConfig,
} from './types';

export {
    DEFAULT_DERIVE_CONFIG,
    initialSignalState,
    isTerminalLifecycle,
} from './types';

export { derive, deriveAll, withKillReason } from './derive';

export { classifyExit, type ExitClassification } from './exit';
