/**
 * Public API surface for the terminal lifecycle module.
 *
 * Pure types + derive function. No I/O — edge code (PTY, hook server)
 * feeds events into `derive`; consumers read the `lifecycle` field of
 * the resulting state.
 */

export type {
    TerminalLifecycle,
    TerminalKillReason,
    AgentStatus,
    TerminalEvent,
    TerminalSignalState,
    DeriveConfig,
} from './types';

export {
    DEFAULT_DERIVE_CONFIG,
    initialSignalState,
    isFinishedLifecycle,
} from './types';

export { derive, deriveAll, withKillReason } from './derive';

export { shouldFlipToActiveOnOutput } from './output-transition';

export { classifyExit, type ExitClassification } from './exit';

export {
    computeTelemetrySnapshot,
    configureTelemetrySink,
    getTierTelemetrySnapshot,
    recordTierEvent,
    type AgentBreakdown,
    type TelemetrySnapshot,
    type TierEvent,
    type TierEventKind,
} from './tierTelemetry';

export {installJsonlTelemetrySink, type JsonlSinkDeps} from './tierTelemetryJsonlSink';
