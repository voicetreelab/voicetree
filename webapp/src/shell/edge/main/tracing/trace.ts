/**
 * Performance tracing utilities using Electron's contentTracing + performance.mark/measure
 *
 * Usage:
 *   import { trace } from '@/shell/edge/main/tracing/trace'
 *
 *   // Wrap an async function to trace it
 *   const result = await trace('createContextNode', async () => {
 *     return await createContextNode(parentNodeId)
 *   })
 *
 */

import { performance } from 'node:perf_hooks'

/**
 * Trace an async operation. Creates performance marks visible in chrome://tracing.
 *
 * @param label - Name for the trace (e.g., 'createContextNode')
 * @param fn - Async function to trace
 * @returns The result of fn()
 */
export async function trace<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const startMark: string = `${label}-start`
    const endMark: string = `${label}-end`

    performance.mark(startMark)
    const startTime: number = performance.now()

    try {
        const result: T = await fn()
        return result
    } finally {
        performance.mark(endMark)
        const _duration: number = performance.now() - startTime

        try {
            performance.measure(label, startMark, endMark)
        } catch {
            // measure can fail if marks were cleared
        }

        // Always log to console for immediate feedback
        //console.log(`[trace] ${label}: ${duration.toFixed(2)}ms`)
    }
}
