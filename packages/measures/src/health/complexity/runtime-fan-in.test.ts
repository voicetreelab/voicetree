import {describe, expect, it} from 'vitest'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {buildRuntimeSymbolsByTarget, runtimeFanInRows} from '../../_shared/graph/runtime-fan-in'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const {max: MAX_RUNTIME_FAN_IN} = readBudgetSync<{max: number}>('complexity/runtime-fan-in.json')

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
