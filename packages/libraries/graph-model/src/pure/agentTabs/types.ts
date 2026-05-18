import type { NodeIdAndFilePath } from '../graph'

/**
 * Branded TerminalId type — matches the shell definition.
 */
export type TerminalId = string & { readonly __brand: 'TerminalId' };

/**
 * Mirrors `TerminalLifecycle` from @vt/agent-runtime/lifecycle. Defined
 * here as well to avoid graph-model depending on agent-runtime (the
 * dependency runs the other direction).
 */
export type TerminalLifecycle =
    | 'spawning'
    | 'active'
    | 'idle'
    | 'awaiting_input'
    | 'completed'
    | 'errored';
