/**
 * Pure transition function for the terminal lifecycle state machine.
 *
 *   derive(state, event, config) → state
 *
 * Black-box testable: feed any sequence of events, observe the resulting
 * state. No I/O, no side effects.
 *
 * State diagram:
 *
 *                   ┌──────────┐
 *                   │ spawning │
 *                   └─────┬────┘
 *                         │ output | agent_event(working)
 *                         ▼
 *                   ┌──────────┐ ◄────────── output | input | agent_event(working)
 *                   │  active  │
 *                   └──┬─────┬─┘
 *      tick (idle ms)  │     │  agent_event(awaiting)
 *                      ▼     ▼
 *               ┌──────────┐ ┌────────────────┐
 *               │   idle   │ │ awaiting_input │
 *               └──────┬───┘ └──────┬─────────┘
 *                      │            │
 *                      └─────┬──────┘
 *                            │
 *                            │  exit | agent_event(done)
 *                            ▼
 *                  ┌──────────┐  ┌──────────┐
 *                  │completed │  │ errored  │  ← terminal states (sticky)
 *                  └──────────┘  └──────────┘
 */

import { classifyExit } from './exit';
import {
    isFinishedLifecycle,
    type TerminalEvent,
    type TerminalLifecycle,
    type TerminalSignalState,
    type DeriveConfig,
} from './types';

function activeFromOutput(state: TerminalSignalState, at: number): TerminalSignalState {
    return {
        ...state,
        lifecycle: 'active',
        lastOutputTime: at,
    };
}

function deriveExit(state: TerminalSignalState, event: Extract<TerminalEvent, { readonly type: 'exit' }>): TerminalSignalState {
    const lifecycle: TerminalLifecycle = classifyExit(event.code, event.signal, state.killReason);
    return { ...state, lifecycle };
}

function deriveInput(state: TerminalSignalState): TerminalSignalState {
    // User typing always means engagement, never "awaiting".
    // Don't touch lastOutputTime — input is not output.
    if (state.lifecycle !== 'awaiting_input') return state;
    return { ...state, lifecycle: 'active' };
}

function deriveAgentEvent(state: TerminalSignalState, event: Extract<TerminalEvent, { readonly type: 'agent_event' }>): TerminalSignalState {
    // Hook events from the agent. Drive the state directly.
    switch (event.kind) {
        case 'awaiting':
            return { ...state, lifecycle: 'awaiting_input' };
        case 'done':
            return { ...state, lifecycle: 'completed' };
        case 'working':
            return activeFromOutput(state, event.at);
    }
}

function hasReachedInactivityThreshold(
    state: TerminalSignalState,
    event: Extract<TerminalEvent, { readonly type: 'tick' }>,
    config: DeriveConfig,
): boolean {
    const elapsed: number = event.at - state.lastOutputTime;
    return elapsed >= config.inactivityThresholdMs;
}

function deriveTick(
    state: TerminalSignalState,
    event: Extract<TerminalEvent, { readonly type: 'tick' }>,
    config: DeriveConfig,
): TerminalSignalState {
    // Inactivity check. Only flips active → idle when:
    //   - lifecycle is currently active
    //   - elapsed since last output exceeds threshold
    if (state.lifecycle !== 'active') return state;
    if (!hasReachedInactivityThreshold(state, event, config)) return state;
    return { ...state, lifecycle: 'idle' };
}

export function derive(
    state: TerminalSignalState,
    event: TerminalEvent,
    config: DeriveConfig,
): TerminalSignalState {
    // Sticky terminal states — once completed/errored, no event changes lifecycle.
    // Bookkeeping fields (lastOutputTime etc.) also frozen.
    if (isFinishedLifecycle(state.lifecycle)) {
        return state;
    }

    switch (event.type) {
        case 'exit': {
            return deriveExit(state, event);
        }

        case 'output': {
            return activeFromOutput(state, event.at);
        }

        case 'input': {
            return deriveInput(state);
        }

        case 'agent_event': {
            return deriveAgentEvent(state, event);
        }

        case 'tick': {
            return deriveTick(state, event, config);
        }
    }
}

/**
 * Apply a sequence of events to an initial state. Convenience wrapper for
 * testing and replaying recorded streams.
 */
export function deriveAll(
    initial: TerminalSignalState,
    events: readonly TerminalEvent[],
    config: DeriveConfig,
): TerminalSignalState {
    let state: TerminalSignalState = initial;
    for (const event of events) {
        state = derive(state, event, config);
    }
    return state;
}

/**
 * Mark the kill reason on a state. Edge code calls this immediately before
 * issuing a SIGTERM so the subsequent `exit` event classifies as completed
 * rather than errored.
 */
export function withKillReason(
    state: TerminalSignalState,
    reason: 'user' | 'external',
): TerminalSignalState {
    return { ...state, killReason: reason };
}
