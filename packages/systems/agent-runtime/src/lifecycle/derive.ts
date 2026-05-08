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
 *      tick (idle ms)  │     │  prompt_detected | agent_event(awaiting)
 *      AND not prompt  ▼     ▼
 *               ┌──────────┐ ┌────────────────┐
 *               │   idle   │ │ awaiting_input │
 *               └──────┬───┘ └──────┬─────────┘
 *                      │            │ prompt_cleared (no recent output)
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
    isTerminalLifecycle,
    type TerminalEvent,
    type TerminalLifecycle,
    type TerminalSignalState,
    type DeriveConfig,
} from './types';

export function derive(
    state: TerminalSignalState,
    event: TerminalEvent,
    config: DeriveConfig,
): TerminalSignalState {
    // Sticky terminal states — once completed/errored, no event changes lifecycle.
    // Bookkeeping fields (lastOutputTime etc.) also frozen.
    if (isTerminalLifecycle(state.lifecycle)) {
        return state;
    }

    switch (event.type) {
        case 'exit': {
            const lifecycle: TerminalLifecycle = classifyExit(event.code, event.signal, state.killReason);
            return { ...state, lifecycle };
        }

        case 'output': {
            // Output flowing → active. Output also clears any standing prompt:
            // if Claude was awaiting and starts typing, it's working again.
            return {
                ...state,
                lifecycle: 'active',
                lastOutputTime: event.at,
                promptDetected: false,
            };
        }

        case 'input': {
            // User typing always means engagement, never "awaiting".
            // Don't touch lastOutputTime — input is not output.
            if (state.lifecycle === 'awaiting_input') {
                return { ...state, lifecycle: 'active', promptDetected: false };
            }
            return state;
        }

        case 'agent_event': {
            // Tier-1 hook events. Highest confidence — drive the state directly.
            switch (event.kind) {
                case 'awaiting':
                    return { ...state, lifecycle: 'awaiting_input', promptDetected: true };
                case 'done':
                    return { ...state, lifecycle: 'completed' };
                case 'working':
                    return { ...state, lifecycle: 'active', lastOutputTime: event.at, promptDetected: false };
            }
        }

        case 'prompt_detected': {
            // Tier-3 detector. Only meaningful when not already awaiting.
            if (state.lifecycle === 'awaiting_input') {
                return { ...state, promptDetected: true };
            }
            return { ...state, lifecycle: 'awaiting_input', promptDetected: true };
        }

        case 'prompt_cleared': {
            if (!state.promptDetected) return state;

            // If we were awaiting, decide where to fall back to:
            //   - if recent output → active
            //   - else → idle
            if (state.lifecycle === 'awaiting_input') {
                const elapsed: number = event.at - state.lastOutputTime;
                const lifecycle: TerminalLifecycle =
                    elapsed >= config.inactivityThresholdMs ? 'idle' : 'active';
                return { ...state, lifecycle, promptDetected: false };
            }
            return { ...state, promptDetected: false };
        }

        case 'tick': {
            // Inactivity check. Only flips active → idle when:
            //   - lifecycle is currently active
            //   - elapsed since last output exceeds threshold
            //   - no prompt is currently shown (else awaiting_input wins)
            if (state.lifecycle !== 'active') return state;
            if (state.promptDetected) return state;

            const elapsed: number = event.at - state.lastOutputTime;
            if (elapsed < config.inactivityThresholdMs) return state;

            return { ...state, lifecycle: 'idle' };
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
