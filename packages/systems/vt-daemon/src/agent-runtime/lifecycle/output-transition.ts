/**
 * Pure decision: should an `output` event flip a terminal's lifecycle to 'active'?
 *
 * Mirrors the `output` branch of `derive` (which always sets lifecycle = 'active'
 * unless the carry state is a sticky end state) but is exposed for renderer-side
 * pollers that talk to the registry through IPC instead of through `derive`.
 * Centralising the rule here prevents the gate from drifting back to a stale
 * `isDone` boolean — which previously left freshly-spawned terminals stuck on
 * the muted-grey 'spawning' icon while their PTY produced output.
 */

import { isTerminalLifecycle, type TerminalLifecycle } from './types';

export function shouldFlipToActiveOnOutput(lifecycle: TerminalLifecycle): boolean {
    if (isTerminalLifecycle(lifecycle)) return false; // completed / errored — sticky.
    return lifecycle !== 'active';
}
