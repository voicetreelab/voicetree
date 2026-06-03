// Pure exponential-backoff policy for the browser's long-lived streams.
//
// The VTD /events WebSocket is the ONE persistent connection in browser mode;
// when it drops it must reconnect without hammering the daemon. This module is
// the pure decision — `reconnectDelayMs(policy, attempt)` — so the schedule is
// unit-testable without a socket. The shell (vtdSubscribeEvents) owns the timer
// and the attempt counter; it asks this function how long to wait.

export interface ReconnectPolicy {
    /** Delay before the first retry (attempt 0). */
    readonly baseDelayMs: number
    /** Upper bound — the delay never exceeds this however many attempts fail. */
    readonly maxDelayMs: number
    /** Multiplier applied per successive failed attempt. */
    readonly factor: number
}

/** 1s, 2s, 4s, … capped at 30s — the surviving policy from the SSE-reconnect plan. */
export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    factor: 2,
}

/**
 * Delay (ms) before the retry following `attempt` consecutive failures.
 * `attempt` is 0-based: 0 → the first reconnect after a fresh drop. Grows
 * geometrically and saturates at `maxDelayMs`. Negative attempts clamp to the
 * base delay so a caller bug can never produce a sub-base or NaN wait.
 */
export function reconnectDelayMs(policy: ReconnectPolicy, attempt: number): number {
    const steps = attempt > 0 ? attempt : 0
    const raw = policy.baseDelayMs * Math.pow(policy.factor, steps)
    return Math.min(raw, policy.maxDelayMs)
}
