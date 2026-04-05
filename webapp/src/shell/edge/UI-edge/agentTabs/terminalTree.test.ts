import { describe, it, expect } from 'vitest';
import { buildTerminalTree } from '@vt/graph-model/pure/agentTabs/terminalTree';
import type { TerminalTreeNode } from '@vt/graph-model/pure/agentTabs/terminalTree';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';

// Helper to create minimal TerminalData for testing
function createTerminal(
  terminalId: string,
  parentTerminalId: string | null = null,
  title = `Terminal ${terminalId}`
): TerminalData {
  return {
    type: 'Terminal',
    terminalId: terminalId as TerminalId,
    attachedToContextNodeId: 'test-node.md',
    terminalCount: 1,
    title,
    isPinned: true,
    isDone: false,
    lastOutputTime: Date.now(),
    activityCount: 0,
    parentTerminalId: parentTerminalId as TerminalId | null,
    // FloatingWindowFields
    windowId: `window-${terminalId}`,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    visible: true,
    resizable: true,
    alwaysOnTop: false,
  } as TerminalData;
}

describe('buildTerminalTree', () => {
  it('returns empty array for empty input', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([]);
    expect(result).toEqual([]);
  });

  it('returns single root at depth 0', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([createTerminal('a')]);
    expect(result).toHaveLength(1);
    expect(result[0].terminal.terminalId).toBe('a');
    expect(result[0].depth).toBe(0);
  });

  it('returns parent before child with correct depths', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([createTerminal('parent', null), createTerminal('child', 'parent')]);
    expect(result).toHaveLength(2);
    expect(result[0].terminal.terminalId).toBe('parent');
    expect(result[0].depth).toBe(0);
    expect(result[1].terminal.terminalId).toBe('child');
    expect(result[1].depth).toBe(1);
  });

  it('handles multiple roots with one having children', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([
      createTerminal('root1', null),
      createTerminal('root2', null),
      createTerminal('child1', 'root1'),
    ]);
    expect(result).toHaveLength(3);
    const root1Idx: number = result.findIndex(n => n.terminal.terminalId === 'root1');
    const child1Idx: number = result.findIndex(n => n.terminal.terminalId === 'child1');
    expect(child1Idx).toBe(root1Idx + 1);
    expect(result.find(n => n.terminal.terminalId === 'root1')?.depth).toBe(0);
    expect(result.find(n => n.terminal.terminalId === 'root2')?.depth).toBe(0);
    expect(result.find(n => n.terminal.terminalId === 'child1')?.depth).toBe(1);
  });

  it('handles three levels deep (grandchild)', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([
      createTerminal('grandparent', null),
      createTerminal('parent', 'grandparent'),
      createTerminal('grandchild', 'parent'),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].depth).toBe(0);
    expect(result[1].depth).toBe(1);
    expect(result[2].depth).toBe(2);
  });

  it('treats orphaned child (missing parent) as root', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([createTerminal('orphan', 'nonexistent-parent')]);
    expect(result).toHaveLength(1);
    expect(result[0].terminal.terminalId).toBe('orphan');
    expect(result[0].depth).toBe(0);
  });

  it('handles mixed orphans and normal tree', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([
      createTerminal('root', null),
      createTerminal('child', 'root'),
      createTerminal('orphan', 'missing-parent'),
    ]);
    expect(result).toHaveLength(3);
    const ids: string[] = result.map(n => n.terminal.terminalId);
    expect(ids).toContain('root');
    expect(ids).toContain('child');
    expect(ids).toContain('orphan');
    expect(result.find(n => n.terminal.terminalId === 'orphan')?.depth).toBe(0);
  });

  it('maintains DFS order with multiple children', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([
      createTerminal('root', null),
      createTerminal('child1', 'root'),
      createTerminal('child2', 'root'),
      createTerminal('grandchild1', 'child1'),
    ]);
    expect(result).toHaveLength(4);
    const child1Idx: number = result.findIndex(n => n.terminal.terminalId === 'child1');
    const grandchild1Idx: number = result.findIndex(n => n.terminal.terminalId === 'grandchild1');
    const child2Idx: number = result.findIndex(n => n.terminal.terminalId === 'child2');
    expect(grandchild1Idx).toBeGreaterThan(child1Idx);
    expect(grandchild1Idx).toBeLessThan(child2Idx); // DFS visits child1's subtree before child2
  });

  it('handles input order independence for parent-child', () => {
    // Child appears before parent in input
    const result: TerminalTreeNode[] = buildTerminalTree([
      createTerminal('child', 'parent'),
      createTerminal('parent', null),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].terminal.terminalId).toBe('parent');
    expect(result[0].depth).toBe(0);
    expect(result[1].terminal.terminalId).toBe('child');
    expect(result[1].depth).toBe(1);
  });

  it('handles deeply nested hierarchy (4 levels)', () => {
    const result: TerminalTreeNode[] = buildTerminalTree([
      createTerminal('level0', null),
      createTerminal('level1', 'level0'),
      createTerminal('level2', 'level1'),
      createTerminal('level3', 'level2'),
    ]);
    expect(result).toHaveLength(4);
    expect(result[0].depth).toBe(0);
    expect(result[1].depth).toBe(1);
    expect(result[2].depth).toBe(2);
    expect(result[3].depth).toBe(3);
  });
});
