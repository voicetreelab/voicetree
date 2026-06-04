// Black-box test for the shared "Run Agent on Selected Nodes" orchestrator.
// The function's collaborators are explicit parameters (RunAgentEffects), so we
// supply real recording effects and assert on the OBSERVABLE outcome: the delta
// that was applied, the spawn request that was emitted, and the returned result.
// No internal mocking — the effects ARE the function's contract surface.

import {describe, expect, it} from 'vitest'
import {createGraph, type GraphDelta, type NodeIdAndFilePath} from '@vt/graph-model/graph'
import * as O from 'fp-ts/lib/Option.js'
import {orchestrateRunAgentOnSelectedNodes, type RunAgentEffects, type SpawnAgentTerminalRequest} from './orchestrateRunAgent'

interface Recorder {
    appliedDeltas: GraphDelta[]
    spawnRequests: SpawnAgentTerminalRequest[]
}

function recordingEffects(rec: Recorder, writeFolder: O.Option<string>): RunAgentEffects {
    return {
        getGraph: () => Promise.resolve(createGraph({})),
        getWriteFolderPath: () => Promise.resolve(writeFolder),
        applyTaskNodeDelta: (delta) => {
            rec.appliedDeltas.push(delta)
            return Promise.resolve(undefined)
        },
        spawnAgentTerminal: (req) => {
            rec.spawnRequests.push(req)
            return Promise.resolve({terminalId: 'term-1', contextNodeId: 'ctx.md' as NodeIdAndFilePath})
        },
    }
}

describe('runAgentOnSelectedNodes (shared orchestrator)', () => {
    it('applies the task-node delta then spawns the agent terminal for that task node', async () => {
        const rec: Recorder = {appliedDeltas: [], spawnRequests: []}
        const selectedNodeIds = ['/proj/a.md', '/proj/b.md'] as NodeIdAndFilePath[]

        const result = await orchestrateRunAgentOnSelectedNodes(
            {selectedNodeIds, taskDescription: 'do the thing'},
            recordingEffects(rec, O.some('/proj')),
        )

        // A task-node delta was applied, and its UpsertNode id is the task node.
        expect(rec.appliedDeltas).toHaveLength(1)
        const head = rec.appliedDeltas[0][0]
        expect(head.type).toBe('UpsertNode')
        const taskNodeId = head.type === 'UpsertNode' ? head.nodeToUpsert.absoluteFilePathIsID : ''
        expect(result.taskNodeId).toBe(taskNodeId)

        // Exactly one spawn, carrying the created task node and the selection.
        expect(rec.spawnRequests).toHaveLength(1)
        expect(rec.spawnRequests[0].taskNodeId).toBe(taskNodeId)
        expect(rec.spawnRequests[0].selectedNodeIds).toEqual(selectedNodeIds)

        // The result surfaces the spawn effect's returned ids.
        expect(result.terminalId).toBe('term-1')
        expect(result.contextNodeId).toBe('ctx.md')
    })

    it('spawns only AFTER the delta is applied (task node must exist first)', async () => {
        const order: string[] = []
        const selectedNodeIds = ['/proj/a.md'] as NodeIdAndFilePath[]
        const effects: RunAgentEffects = {
            getGraph: () => Promise.resolve(createGraph({})),
            getWriteFolderPath: () => Promise.resolve(O.some('/proj')),
            applyTaskNodeDelta: () => {
                order.push('apply')
                return Promise.resolve(undefined)
            },
            spawnAgentTerminal: () => {
                order.push('spawn')
                return Promise.resolve({terminalId: 't', contextNodeId: 'c.md' as NodeIdAndFilePath})
            },
        }

        await orchestrateRunAgentOnSelectedNodes({selectedNodeIds, taskDescription: 'x'}, effects)
        expect(order).toEqual(['apply', 'spawn'])
    })

    it('throws when no nodes are selected (never touches the daemon)', async () => {
        const rec: Recorder = {appliedDeltas: [], spawnRequests: []}
        await expect(
            orchestrateRunAgentOnSelectedNodes({selectedNodeIds: [], taskDescription: 'x'}, recordingEffects(rec, O.some('/proj'))),
        ).rejects.toThrow('No nodes selected')
        expect(rec.appliedDeltas).toHaveLength(0)
        expect(rec.spawnRequests).toHaveLength(0)
    })
})
