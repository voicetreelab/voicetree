// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cytoscape from 'cytoscape';
import type { Core, EdgeSingular } from 'cytoscape';
import type { NodeIdAndFilePath } from '@vt/graph-model/graph';
import { createTerminalData } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import {
    getShadowNodeId,
    type ShadowNodeId,
    type TerminalId,
} from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState';
import { createFloatingTerminal } from './createFloatingTerminal';
import { clearTerminals, setTerminalUI } from '@/shell/edge/UI-edge/state/stores/TerminalStore';
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI';
import type { ProjectedGraph } from '@vt/graph-state/contract';

vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

vi.mock('@/shell/UI/floating-windows/terminals/TerminalVanilla', () => ({
    TerminalVanilla: vi.fn().mockImplementation(() => ({
        dispose: vi.fn(),
        focus: vi.fn(),
    })),
}));

const SOURCE_TASK_NODE_ID: NodeIdAndFilePath = '/project/source-task.md' as NodeIdAndFilePath;
const CONTEXT_NODE_ID: NodeIdAndFilePath = '/project/ctx-nodes/context_context_123.md' as NodeIdAndFilePath;
const LATE_TASK_NODE_ID: NodeIdAndFilePath = '/project/late-node.md' as NodeIdAndFilePath;
const TERMINAL_ID: TerminalId = 'behavioural-terminal' as TerminalId;

function createTestCy(includeAnchorNode: boolean): Core {
    const cy: Core = cytoscape({
        headless: true,
        elements: [
            { data: { id: SOURCE_TASK_NODE_ID }, position: { x: 500, y: 500 } },
            ...(includeAnchorNode
                ? [{ data: { id: LATE_TASK_NODE_ID }, position: { x: 1000, y: 1000 } }]
                : []),
        ],
        style: [
            { selector: 'node', style: { width: 120, height: 60 } },
        ],
    });

    cy.zoom(1);
    cy.pan({ x: 0, y: 0 });
    return cy;
}

function makeTerminalData(): TerminalData {
    return createTerminalData({
        terminalId: TERMINAL_ID,
        attachedToNodeId: CONTEXT_NODE_ID,
        terminalCount: 0,
        title: 'Behavioural terminal',
        anchoredToNodeId: LATE_TASK_NODE_ID,
        agentName: 'TestAgent',
        shadowNodeDimensions: { width: 395, height: 380 },
    });
}

function getShadowId(): ShadowNodeId {
    return getShadowNodeId(TERMINAL_ID);
}

function getParentToShadowEdge(cy: Core, parentNodeId: NodeIdAndFilePath, shadowNodeId: ShadowNodeId): EdgeSingular | undefined {
    return cy.edges().find((edge: EdgeSingular) =>
        edge.source().id() === parentNodeId && edge.target().id() === shadowNodeId
    );
}

async function settleDomWork(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function assertTerminalAnchoredToLateNode(cy: Core, terminal: TerminalData): Promise<void> {
    await settleDomWork();

    const shadowNodeId: ShadowNodeId = getShadowId();
    const shadowNode = cy.getElementById(shadowNodeId);
    expect(shadowNode.length).toBe(1);
    expect(shadowNode.data('parentNodeId')).toBe(LATE_TASK_NODE_ID);

    const edge: EdgeSingular | undefined = getParentToShadowEdge(cy, LATE_TASK_NODE_ID, shadowNodeId);
    expect(edge).toBeDefined();

    expect(terminal.ui?.windowElement.style.left).not.toBe('100px');
    expect(terminal.ui?.windowElement.style.top).not.toBe('100px');
}

function makeGraphWithLateTaskNode(): ProjectedGraph {
    return {
        nodes: [
            {
                id: SOURCE_TASK_NODE_ID,
                label: 'Source task',
                content: '# Source task\n',
                position: { x: 500, y: 500 },
            },
            {
                id: LATE_TASK_NODE_ID,
                label: 'Late node',
                content: '# Late node\n',
                position: { x: 1000, y: 1000 },
            },
        ],
        edges: [],
    } as ProjectedGraph;
}

describe('createFloatingTerminal behavioural anchoring', () => {
    let cy: Core;

    beforeEach(() => {
        document.body.innerHTML = '';
        vanillaFloatingWindowInstances.clear();
        clearTerminals();
        vi.clearAllMocks();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number =>
            window.setTimeout(() => callback(performance.now()), 0)
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
            window.clearTimeout(id);
        });
    });

    afterEach(() => {
        cy?.destroy();
        vanillaFloatingWindowInstances.clear();
        clearTerminals();
        document.body.innerHTML = '';
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('anchors after the target node arrives later than waitForNode timeout', async () => {
        cy = createTestCy(false);
        const terminalData: TerminalData = makeTerminalData();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const terminal: TerminalData | undefined = await createFloatingTerminal(cy, SOURCE_TASK_NODE_ID, terminalData);

        expect(terminal).toBeDefined();
        expect(terminal?.ui?.windowElement.style.left).toBe('100px');
        expect(terminal?.ui?.windowElement.style.top).toBe('100px');

        cy.add({ group: 'nodes', data: { id: LATE_TASK_NODE_ID }, position: { x: 1000, y: 1000 } });

        await assertTerminalAnchoredToLateNode(cy, terminal as TerminalData);
        warnSpy.mockRestore();
    }, 10_000);

    it('re-anchors when the target node is removed after a deferred anchor and later re-projected', async () => {
        cy = createTestCy(false);
        const terminalData: TerminalData = makeTerminalData();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const terminal: TerminalData | undefined = await createFloatingTerminal(cy, SOURCE_TASK_NODE_ID, terminalData);
        expect(terminal?.ui).toBeDefined();
        setTerminalUI(TERMINAL_ID, terminal?.ui as NonNullable<TerminalData['ui']>, terminal);

        cy.add({ group: 'nodes', data: { id: LATE_TASK_NODE_ID }, position: { x: 1000, y: 1000 } });
        await assertTerminalAnchoredToLateNode(cy, terminal as TerminalData);

        cy.remove(cy.getElementById(LATE_TASK_NODE_ID));
        applyGraphDeltaToUI(cy, makeGraphWithLateTaskNode());

        await assertTerminalAnchoredToLateNode(cy, terminal as TerminalData);
        warnSpy.mockRestore();
    }, 10_000);

    it('anchors when the target node already exists in Cytoscape', async () => {
        cy = createTestCy(true);
        const terminalData: TerminalData = makeTerminalData();

        const terminal: TerminalData | undefined = await createFloatingTerminal(cy, SOURCE_TASK_NODE_ID, terminalData);

        expect(terminal).toBeDefined();
        await assertTerminalAnchoredToLateNode(cy, terminal as TerminalData);
    }, 10_000);
});
