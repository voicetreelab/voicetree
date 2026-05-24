import {afterEach, describe, expect, it} from 'vitest'
import type {GraphDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {configureAgentRuntime} from '../runtime-config'
import {
    applyRuntimeGraphDelta,
    getRuntimeGraph,
    getRuntimeProjectRoot,
    getRuntimeUnseenNodesAroundContextNode,
    getRuntimeVaultPaths,
    getRuntimeWatchStatus,
    getRuntimeWriteFolder,
    runtimeCreateContextNode,
    runtimeCreateContextNodeFromSelectedNodes,
    runtimeUpdateContextNodeContainedIds,
} from '../graph-bridge'

const MISSING_BRIDGE_ERROR: string =
    'Agent runtime graph bridge not configured. Call configureAgentRuntime({ graph: ... }) at boot.'

describe('graph bridge runtime accessors', () => {
    afterEach(() => {
        configureAgentRuntime({})
    })

    it('throws a clear error instead of falling back to graph-db-server when no bridge is configured', async () => {
        configureAgentRuntime({})

        await expect(getRuntimeGraph()).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(getRuntimeWriteFolder()).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(getRuntimeVaultPaths()).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(applyRuntimeGraphDelta({} as GraphDelta)).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(getRuntimeProjectRoot()).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(getRuntimeWatchStatus()).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(runtimeCreateContextNode('parent.md' as NodeIdAndFilePath)).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(runtimeCreateContextNodeFromSelectedNodes(
            'task.md' as NodeIdAndFilePath,
            ['selected.md' as NodeIdAndFilePath],
        )).rejects.toThrow(MISSING_BRIDGE_ERROR)
        await expect(getRuntimeUnseenNodesAroundContextNode('context.md' as NodeIdAndFilePath)).rejects.toThrow(
            MISSING_BRIDGE_ERROR,
        )
        await expect(runtimeUpdateContextNodeContainedIds('context.md' as NodeIdAndFilePath, [])).rejects.toThrow(
            MISSING_BRIDGE_ERROR,
        )
    })
})
