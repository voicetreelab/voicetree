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
import type { NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { TerminalId, FloatingWindowUIData, TerminalData } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import { createTerminalData } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'

// Mock heavy renderer dependencies before importing the module under test
vi.mock('@/shell/edge/UI-edge/floating-windows/anchoring/cytoscape-floating-windows', () => ({
    getOrCreateOverlay: vi.fn(() => document.createElement('div')),
    registerFloatingWindow: vi.fn(),
}))

vi.mock('@/shell/UI/floating-windows/terminals/TerminalVanilla', () => ({
    TerminalVanilla: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }))

vi.mock('@/shell/edge/UI-edge/floating-windows/chrome/create-window-chrome', () => ({
    createWindowChrome: vi.fn((): FloatingWindowUIData => ({
        windowElement: document.createElement('div'),
        contentContainer: document.createElement('div'),
    })),
}))

vi.mock('@/shell/edge/UI-edge/floating-windows/anchoring/anchor-to-node', () => ({
    anchorToNode: (_cy: unknown, terminalWithUI: { ui?: { windowElement: HTMLElement } }) => {
        const windowElement = terminalWithUI.ui?.windowElement
        if (!windowElement) return

        const nextCount = Number(windowElement.dataset.anchorCount ?? '0') + 1
        windowElement.dataset.anchorCount = String(nextCount)
    },
}))

vi.mock('@/shell/UI/cytoscape-graph-ui/services/layout/spatialIndexSync', () => ({
    getCurrentIndex: vi.fn(() => undefined),
}))

vi.mock('@/shell/edge/UI-edge/state/stores/UIAppState', () => ({
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
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState'

type TestCy = import('cytoscape').Core & {
    getNodeData: (key: string) => unknown
}

function createFakeNode(id: string): { node: unknown; getNodeData: (key: string) => unknown } {
    const nodeData: Record<string, unknown> = {}
    return {
        node: {
            id: () => id,
            length: 1,
            data: (key?: string, value?: unknown) => {
                if (key === undefined) return nodeData
                if (value !== undefined) nodeData[key] = value
                return nodeData[key]
            },
        },
        getNodeData: (key: string) => nodeData[key],
    }
}

function makeCy(nodeExists: boolean): TestCy {
    const { node: fakeNode, getNodeData } = createFakeNode('test')
    const emptyCollection = { length: 0, data: vi.fn() }
    return {
        getElementById: vi.fn(() => (nodeExists ? fakeNode : emptyCollection) as unknown),
        on: vi.fn(),
        off: vi.fn(),
        getNodeData,
    } as unknown as TestCy
}

function makeCyWithLateNode(targetNodeId: string): TestCy & { addNode: (id: string) => void } {
    let existingNodeId: string | null = null
    const addHandlers: Array<(event: { target: { id: () => string } }) => void> = []
    const { node: fakeNode, getNodeData } = createFakeNode(targetNodeId)
    const emptyCollection = { length: 0, data: vi.fn() }

    const cy = {
        getElementById: vi.fn((id: string) => {
            if (id !== existingNodeId) return emptyCollection as unknown
            return fakeNode
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
        getNodeData,
    }

    return cy as unknown as TestCy & { addNode: (id: string) => void }
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
        expect(result?.ui?.windowElement.style.left).toBe('100px')
        expect(result?.ui?.windowElement.style.top).toBe('100px')
        expect(result?.ui?.windowElement.dataset.anchorCount).toBeUndefined()
        expect(cy.getNodeData('hasRunningTerminal')).toBeUndefined()
    }, 10_000)

    it('anchors to node when waitForNode finds it', async () => {
        const cy = makeCy(true) // node exists in Cytoscape
        const data = makeTerminalData('/vault/task.md')

        const result = await createFloatingTerminal(cy, '/vault/task.md', data)

        expect(result).toBeDefined()
        expect(result?.ui?.windowElement.dataset.anchorCount).toBe('1')
        expect(cy.getNodeData('hasRunningTerminal')).toBe(true)
    }, 10_000)

    it('anchors after a timed-out target node is later added to Cytoscape', async () => {
        const cy = makeCyWithLateNode('/vault/task.md')
        const data = makeTerminalData('/vault/task.md')

        const result = await createFloatingTerminal(cy, '/vault/task.md', data)
        expect(result).toBeDefined()
        expect(result?.ui?.windowElement.dataset.anchorCount).toBeUndefined()
        expect(result?.ui?.windowElement.style.left).toBe('100px')
        expect(result?.ui?.windowElement.style.top).toBe('100px')

        cy.addNode('/vault/task.md')

        expect(result?.ui?.windowElement.dataset.anchorCount).toBe('1')
        expect(cy.getNodeData('hasRunningTerminal')).toBe(true)

        cy.addNode('/vault/task.md')

        expect(result?.ui?.windowElement.dataset.anchorCount).toBe('1')
    }, 10_000)
})
