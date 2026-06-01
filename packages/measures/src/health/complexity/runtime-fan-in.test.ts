import {describe, expect, it} from 'vitest'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {buildRuntimeSymbolsByTarget, runtimeFanInRows} from '../../_shared/graph/runtime-fan-in'

// Captured 2026-05-15 after widening discovery to whole repo via discoverPackages(); ratchet down over time.
// Re-anchored 2026-06-01: create-graph RPC feature added graph-model consumers, raising the observed
// max from 107 to 114. Ratchet DOWN as create-graph is consolidated.
const MAX_RUNTIME_FAN_IN = 115         // observed max: 114 (graph-model receives 114 named symbols)

describe('runtime fan-in health', () => {
    it('keeps runtime fan-in within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const runtimeSymbolsByTarget = await buildRuntimeSymbolsByTarget(packages, files)
        const runtimeFanIn = runtimeFanInRows(runtimeSymbolsByTarget)
        const maxRuntimeFanIn = runtimeFanIn[0]?.runtimeSymbols ?? 0

        console.info(`\nRuntime fan-in:\n${runtimeFanIn.map(row => `${row.packageName} | ${row.runtimeSymbols} | ${row.top.join(', ')}`).join('\n')}`)

        await recordHealthMetric({
            metricId: 'runtime-fan-in',
            metricName: 'Runtime Fan-In',
            description: 'Maximum distinct runtime symbols imported from a package by other discovered packages.',
            category: 'Coupling',
            current: maxRuntimeFanIn,
            budget: MAX_RUNTIME_FAN_IN,
            comparison: 'lte',
            unit: 'symbols',
            details: {runtimeFanIn, fileCount: files.length},
        })

        expect.soft(maxRuntimeFanIn).toBeLessThanOrEqual(MAX_RUNTIME_FAN_IN)
    }, 60000)
})
