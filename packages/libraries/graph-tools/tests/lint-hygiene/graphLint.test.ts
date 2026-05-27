import { describe } from 'vitest'
import { describeCheckRules } from './graphLint/checkRules'
import { describeClassifyEdges } from './graphLint/classifyEdges'
import { describeComputeNodeMetrics } from './graphLint/computeNodeMetrics'
import { describeBuildContainmentTree } from './graphLint/containmentTree'
import { describeLintGraphIntegration } from './graphLint/lintGraphIntegration'
import { createTempDirLifecycle } from './graphLint/tempDirLifecycle'

describe('graphLint', () => {
    const tempDir = createTempDirLifecycle()

    describeLintGraphIntegration(tempDir)
    describeBuildContainmentTree()
    describeClassifyEdges()
    describeComputeNodeMetrics()
    describeCheckRules()
})
