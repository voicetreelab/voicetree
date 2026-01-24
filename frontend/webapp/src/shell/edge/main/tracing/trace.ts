/**
 * Performance tracing utilities using Electron's contentTracing + performance.mark/measure
 *
 * Usage:
 *   import { trace, startTracing, stopTracing } from '@/shell/edge/main/tracing/trace'
 *
 *   // Wrap an async function to trace it
 *   const result = await trace('createContextNode', async () => {
 *     return await createContextNode(parentNodeId)
 *   })
 *
 *   // Or manually control tracing session
 *   await startTracing()
 *   // ... do operations with trace() calls ...
 *   const tracePath = await stopTracing()
 *   // Open chrome://tracing and load the file
 */

import { contentTracing } from 'electron'
import { performance } from 'node:perf_hooks'

let isTracing: boolean = false

/**
 * Start a tracing session. Call stopTracing() to end and get the trace file.
 */
export async function startTracing(): Promise<void> {
    if (isTracing) {
        //console.log('[trace] Already tracing')
        return
    }

    await contentTracing.startRecording({
        included_categories: [
            'node',
            'v8',
            'electron',
            'blink.user_timing',  // captures performance.mark/measure
        ]
    })
    isTracing = true
    //console.log('[trace] Started tracing')
}

/**
 * Stop tracing and return the path to the trace file.
 * Open chrome://tracing in Chrome and load this file to analyze.
 */
export async function stopTracing(): Promise<string> {
    if (!isTracing) {
        //console.log('[trace] Not currently tracing')
        return ''
    }

    const tracePath: string = await contentTracing.stopRecording()
    isTracing = false
    //console.log('[trace] Stopped tracing. File:', tracePath)
    //console.log('[trace] Open chrome://tracing and load the file to analyze')
    return tracePath
}

/**
 * Check if tracing is currently active
 */
export function isTracingActive(): boolean {
    return isTracing
}

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
        const duration: number = performance.now() - startTime

        try {
            performance.measure(label, startMark, endMark)
        } catch {
            // measure can fail if marks were cleared
        }

        // Always log to console for immediate feedback
        //console.log(`[trace] ${label}: ${duration.toFixed(2)}ms`)
    }
}

/**
 * Trace a sync operation
 */
export function traceSync<T>(label: string, fn: () => T): T {
    const startMark: string = `${label}-start`
    const endMark: string = `${label}-end`

    performance.mark(startMark)
    const startTime: number = performance.now()

    try {
        const result: T = fn()
        return result
    } finally {
        performance.mark(endMark)
        const duration: number = performance.now() - startTime

        try {
            performance.measure(label, startMark, endMark)
        } catch {
            // measure can fail if marks were cleared
        }

        //console.log(`[trace] ${label}: ${duration.toFixed(2)}ms`)
    }
}
