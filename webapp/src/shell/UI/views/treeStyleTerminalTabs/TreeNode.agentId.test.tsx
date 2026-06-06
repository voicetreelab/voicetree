// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, render} from '@testing-library/react';
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import {TreeNode} from './TerminalTreeSidebar';
import type {TerminalTreeNode, ChildStatusSummary} from '@vt/graph-model/agent-tabs';

const EMPTY_SUMMARY: ChildStatusSummary = {
    total: 0, spawning: 0, active: 0, idle: 0, awaiting: 0, completed: 0, errored: 0,
};

function makeTerminal(overrides: Partial<TerminalData> = {}): TerminalData {
    return {
        type: 'Terminal',
        terminalId: 'Zoe-iyi' as TerminalId,
        attachedToContextNodeId: '/project/ctx.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        title: 'some task',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        initialCommand: 'claude',
        initialEnvVars: {VOICETREE_PROJECT_PATH: '/project'},
        ...overrides,
    } as TerminalData;
}

function makeTreeNode(terminal: TerminalData): TerminalTreeNode {
    return {terminal, depth: 0, hasChildren: false, directChildCount: 0, descendantSummary: EMPTY_SUMMARY};
}

function renderRow(terminal: TerminalData): HTMLElement {
    const {container} = render(
        <TreeNode
            treeNode={makeTreeNode(terminal)}
            isActive={false}
            shortcutHint={null}
            onSelect={() => {}}
            isCollapsed={false}
            onToggleCollapse={() => {}}
            resumeCliType={null}
        />,
    );
    const span: HTMLElement | null = container.querySelector('.terminal-tree-agent-id');
    if (!span) throw new Error('agent-id span not rendered');
    return span;
}

describe('TreeNode agent-id rendering', () => {
    afterEach(cleanup);

    it('shows the base name (hash stripped) but keeps the full id in the tooltip', () => {
        const span: HTMLElement = renderRow(makeTerminal({terminalId: 'Zoe-iyi' as TerminalId}));
        // Visible text is the friendly base name only.
        expect(span.textContent).toBe('Zoe');
        // The full, unique id is preserved on hover for disambiguation.
        expect(span.getAttribute('title')).toBe('Zoe-iyi');
    });

    it('strips the hash before appending the headless suffix', () => {
        const span: HTMLElement = renderRow(makeTerminal({terminalId: 'Sam-q4z' as TerminalId, isHeadless: true}));
        expect(span.textContent).toBe('Sam (Headless)');
        expect(span.getAttribute('title')).toBe('Sam-q4z');
    });

    it('strips the hash before appending the agent-type suffix', () => {
        const span: HTMLElement = renderRow(makeTerminal({terminalId: 'Max-0a9' as TerminalId, agentTypeName: 'Claude'}));
        expect(span.textContent).toBe('Max - Claude');
        expect(span.getAttribute('title')).toBe('Max-0a9');
    });
});
