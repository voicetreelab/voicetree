import {describe, expect, it} from 'vitest'
import {measureCyclomaticComplexity} from '../../_shared/cyclomatic'
import {discoverPackages} from '../../_shared/discover-packages'
import {discoverSourceFiles} from '../../_shared/function-discovery'
import {formatMaintainabilityRows} from '../../_shared/function-row-formatters'
import {measureMaintainability} from '../../_shared/maintainability'
import {recordHealthMetric} from '../../_shared/report-writer'

// Captured 2026-05-15 after widening discovery to whole repo via discoverPackages(); ratchet down over time.
const MIN_MAINTAINABILITY_INDEX = 0    // observed min: 0 (graph-tools/collapseBoundary.ts); ratchet up

describe('function maintainability index health', () => {
    it('keeps maintainability index within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        const cyclomatic = await measureCyclomaticComplexity(files)
        const maintainability = await measureMaintainability(files, cyclomatic)
        const minMaintainability = maintainability[0]?.maintainabilityIndex ?? 100

        console.info(`\nLowest maintainability files:\n${formatMaintainabilityRows(maintainability)}`)

        await recordHealthMetric({
            metricId: 'function-maintainability-index',
            metricName: 'Function Maintainability Index',
            description: 'Minimum Halstead maintainability index across discovered production source files.',
            category: 'Complexity',
            current: minMaintainability,
            budget: MIN_MAINTAINABILITY_INDEX,
            comparison: 'gte',
            unit: 'index',
            details: {lowestFiles: maintainability.slice(0, 20), fileCount: files.length},
        })

        expect.soft(minMaintainability).toBeGreaterThanOrEqual(MIN_MAINTAINABILITY_INDEX)
    }, 60000)
})
