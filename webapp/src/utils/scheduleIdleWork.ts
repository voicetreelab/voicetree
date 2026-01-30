/**
 * Schedules non-critical work to run when the browser is idle.
 * Uses requestIdleCallback when available, with setTimeout fallback.
 *
 * Use this for operations that:
 * - Don't affect UI responsiveness if slightly delayed
 * - Can wait until the browser has finished critical rendering work
 * - Examples: analytics, state updates for non-visible UI, logging
 *
 * @param callback - Function to execute when idle
 * @param timeout - Maximum time to wait before forcing execution (default: 1000ms)
 */
export function scheduleIdleWork(callback: () => void, timeout: number = 1000): void {
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout });
    } else {
        // Fallback for environments without requestIdleCallback
        setTimeout(callback, 0);
    }
}
