// @vitest-environment jsdom
/**
 * Tests for createFloatingTerminal — specifically the race condition where
 * terminal creation IPC arrives before the SSE graph update, causing
 * waitForNode to return null.
 *
 * Bug: waitForNode's null return was silently discarded, so anchorToNode
 * was called unconditionally and threw "Parent node not found in graph".
 * Fix: check waitForNode result; skip anchoring when node not yet in Cytoscape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { TerminalId, FloatingWindowUIData } from '@/shell/edge/UI-edge/floating-windows/types'
import type { TerminalData } from '@vt/agent-runtime/types'
import { createTerminalData } from '@vt/agent-runtime/types'

// Mock heavy renderer dependencies before importing the module under test
vi.mock('@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows', () => ({
    getOrCreateOverlay: vi.fn(() => document.createElement('div')),
    registerFloatingWindow: vi.fn(),
}))

vi.mock('@/shell/UI/floating-windows/terminals/TerminalVanilla', () => ({
    TerminalVanilla: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

vi.mock('@/shell/edge/UI-edge/floating-windows/create-window-chrome', () => ({
    createWindowChrome: vi.fn((): FloatingWindowUIData => ({
        windowElement: document.createElement('div'),
        contentContainer: document.createElement('div'),
    })),
}))

vi.mock('@/shell/edge/UI-edge/floating-windows/anchor-to-node', () => ({
    anchorToNode: vi.fn(),
}))

vi.mock('@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync', () => ({
    getCurrentIndex: vi.fn(() => undefined),
}))

vi.mock('@/shell/edge/UI-edge/state/UIAppState', () => ({
    vanillaFloatingWindowInstances: new Map(),
}))

vi.mock('@/shell/UI/floating-windows/terminals/InjectBar', () => ({
    createInjectBar: vi.fn(() => ({ element: document.createElement('div'), refresh: vi.fn() })),
    registerInjectBar: vi.fn(),
}))

vi.mock('@/shell/edge/UI-edge/floating-windows/terminals/closeTerminal', () => ({
    closeTerminal: vi.fn(),
}))

import { createFloatingTerminal } from './createFloatingTerminal'
import { anchorToNode } from '@/shell/edge/UI-edge/floating-windows/anchor-to-node'
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState'

function makeCy(nodeExists: boolean): import('cytoscape').Core {
    const fakeNode = {
        id: () => 'test',
        length: 1,
        data: vi.fn(),
    }
    const emptyCollection = { length: 0, data: vi.fn() }
    return {
        getElementById: vi.fn(() => (nodeExists ? fakeNode : emptyCollection) as unknown),
        on: vi.fn(),
        off: vi.fn(),
    } as unknown as import('cytoscape').Core
}

function makeCyWithLateNode(targetNodeId: string): import('cytoscape').Core & { addNode: (id: string) => void } {
    let existingNodeId: string | null = null
    const addHandlers: Array<(event: { target: { id: () => string } }) => void> = []
    const emptyCollection = { length: 0, data: vi.fn() }

    const cy = {
        getElementById: vi.fn((id: string) => {
            if (id !== existingNodeId) return emptyCollection as unknown
            return {
                id: () => id,
                length: 1,
                data: vi.fn(),
            } as unknown
        }),
        on: vi.fn((eventName: string, selector: string, handler: (event: { target: { id: () => string } }) => void) => {
            if (eventName === 'add' && selector === 'node') addHandlers.push(handler)
        }),
        off: vi.fn((eventName: string, selector: string, handler: (event: { target: { id: () => string } }) => void) => {
            if (eventName !== 'add' || selector !== 'node') return
            const index = addHandlers.indexOf(handler)
            if (index >= 0) addHandlers.splice(index, 1)
        }),
        addNode: (id: string) => {
            existingNodeId = id
            for (const handler of [...addHandlers]) {
                handler({ target: { id: () => id } })
            }
        },
    }

    return cy as unknown as import('cytoscape').Core & { addNode: (id: string) => void }
}

function makeTerminalData(anchoredTo?: string): TerminalData {
    return createTerminalData({
        terminalId: 'test-terminal' as TerminalId,
        attachedToNodeId: '/vault/ctx-nodes/ctx.md' as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'Test',
        anchoredToNodeId: anchoredTo as NodeIdAndFilePath | undefined,
        agentName: 'TestAgent',
    })
}

describe('createFloatingTerminal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vanillaFloatingWindowInstances.clear()
    })

    it('returns terminal with fallback position when waitForNode times out', async () => {
        const cy = makeCy(false) // node never appears in Cytoscape
        const data = makeTerminalData('/vault/task.md')

        const result = await createFloatingTerminal(cy, '/vault/task.md', data)

        // Critical: terminal must be created even when node isn't in Cytoscape yet.
        // Before the fix, this returned undefined because anchorToNode threw.
        expect(result).toBeDefined()
        expect(result?.ui).toBeDefined()
    }, 10_000)

    it('anchors to node when waitForNode finds it', async () => {
        const cy = makeCy(true) // node exists in Cytoscape
        const data = makeTerminalData('/vault/task.md')

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = await createFloatingTerminal(cy, '/vault/task.md', data)

        if (!result) {
            const lastError = errorSpy.mock.calls[0]
            errorSpy.mockRestore()
            throw new Error(`createFloatingTerminal returned undefined. Error: ${lastError?.[1]}`)
        }
        errorSpy.mockRestore()

        expect(result).toBeDefined()
        expect(anchorToNode).toHaveBeenCalledTimes(1)
    }, 10_000)

    it('anchors after a timed-out target node is later added to Cytoscape', async () => {
        const cy = makeCyWithLateNode('/vault/task.md')
        const data = makeTerminalData('/vault/task.md')

        const result = await createFloatingTerminal(cy, '/vault/task.md', data)
        expect(result).toBeDefined()
        expect(anchorToNode).not.toHaveBeenCalled()

        cy.addNode('/vault/task.md')

        expect(anchorToNode).toHaveBeenCalledTimes(1)
        expect(cy.off).toHaveBeenCalledTimes(1)
    }, 10_000)
})
