/**
 * Pure reconnection manager module.
 *
 * Tracks reconnection attempts and provides decision logic for
 * reactive reconnection on errors. Designed to be easily testable
 * in isolation with no React dependencies.
 */

// Configuration constants
export const MAX_RECONNECT_ATTEMPTS = 1;
export const RECONNECT_DELAY_MS = 1000;

/**
 * Immutable state for reconnection tracking
 */
export interface ReconnectionState {
  readonly attempts: number;
}

/**
 * Create initial reconnection state
 */
export function createReconnectionState(): ReconnectionState {
  return { attempts: 0 };
}

/**
 * Check if a reconnection attempt should be made based on current state
 */
export function shouldRetry(
  state: ReconnectionState,
  isRecording: boolean,
  maxAttempts: number = MAX_RECONNECT_ATTEMPTS
): boolean {
  return isRecording && state.attempts < maxAttempts;
}

/**
 * Record a reconnection attempt (returns new state)
 */
export function recordAttempt(state: ReconnectionState): ReconnectionState {
  return { attempts: state.attempts + 1 };
}

/**
 * Reset reconnection attempts to zero (returns new state)
 */
export function resetAttempts(): ReconnectionState {
  return { attempts: 0 };
}

/**
 * Schedule a reconnection callback after a delay.
 * Returns a cleanup function to cancel the scheduled reconnection.
 *
 * @param shouldProceed - Function called at execution time to verify reconnection should still happen
 * @param onReconnect - Callback to execute for reconnection
 * @param delayMs - Delay before reconnecting (defaults to RECONNECT_DELAY_MS)
 * @returns Cleanup function to cancel the scheduled reconnection
 */
export function scheduleReconnection(
  shouldProceed: () => boolean,
  onReconnect: () => void,
  delayMs: number = RECONNECT_DELAY_MS
): () => void {
  const timeoutId = setTimeout(() => {
    if (shouldProceed()) {
      onReconnect();
    }
  }, delayMs);
  return () => clearTimeout(timeoutId);
}
