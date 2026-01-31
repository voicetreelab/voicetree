import { describe, it, expect } from 'vitest';
import { buildTerminalTree, type TerminalTreeNode } from './terminalTree';
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
    attachedToNodeId: 'test-node.md',
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
  // Test 1: Empty list returns empty
  it('returns empty array for empty input', () => {
    const result = buildTerminalTree([]);
    expect(result).toEqual([]);
  });

  // Test 2: Single root terminal
  it('returns single root at depth 0', () => {
    const terminal = createTerminal('a');
    const result = buildTerminalTree([terminal]);

    expect(result).toHaveLength(1);
    expect(result[0].terminal.terminalId).toBe('a');
    expect(result[0].depth).toBe(0);
  });

  // Test 3: Parent with one child
  it('returns parent before child with correct depths', () => {
    const parent = createTerminal('parent', null);
    const child = createTerminal('child', 'parent');

    const result = buildTerminalTree([parent, child]);

    expect(result).toHaveLength(2);
    expect(result[0].terminal.terminalId).toBe('parent');
    expect(result[0].depth).toBe(0);
    expect(result[1].terminal.terminalId).toBe('child');
    expect(result[1].depth).toBe(1);
  });

  // Test 4: Multiple roots, one with children
  it('handles multiple roots with one having children', () => {
    const root1 = createTerminal('root1', null);
    const root2 = createTerminal('root2', null);
    const child1 = createTerminal('child1', 'root1');

    const result = buildTerminalTree([root1, root2, child1]);

    expect(result).toHaveLength(3);

    // root1 and its child should be together
    const root1Idx = result.findIndex(n => n.terminal.terminalId === 'root1');
    const child1Idx = result.findIndex(n => n.terminal.terminalId === 'child1');
    expect(child1Idx).toBe(root1Idx + 1); // Child immediately follows parent

    // Verify depths
    expect(result.find(n => n.terminal.terminalId === 'root1')?.depth).toBe(0);
    expect(result.find(n => n.terminal.terminalId === 'root2')?.depth).toBe(0);
    expect(result.find(n => n.terminal.terminalId === 'child1')?.depth).toBe(1);
  });

  // Test 5: Three levels deep (grandchild)
  it('handles three levels deep (grandchild)', () => {
    const grandparent = createTerminal('grandparent', null);
    const parent = createTerminal('parent', 'grandparent');
    const grandchild = createTerminal('grandchild', 'parent');

    const result = buildTerminalTree([grandparent, parent, grandchild]);

    expect(result).toHaveLength(3);
    expect(result[0].terminal.terminalId).toBe('grandparent');
    expect(result[0].depth).toBe(0);
    expect(result[1].terminal.terminalId).toBe('parent');
    expect(result[1].depth).toBe(1);
    expect(result[2].terminal.terminalId).toBe('grandchild');
    expect(result[2].depth).toBe(2);
  });

  // Test 6: Orphaned child (parent doesn't exist) → treated as root
  it('treats orphaned child (missing parent) as root', () => {
    const orphan = createTerminal('orphan', 'nonexistent-parent');

    const result = buildTerminalTree([orphan]);

    expect(result).toHaveLength(1);
    expect(result[0].terminal.terminalId).toBe('orphan');
    expect(result[0].depth).toBe(0); // Treated as root since parent doesn't exist
  });

  // Additional edge cases

  it('handles mixed orphans and normal tree', () => {
    const root = createTerminal('root', null);
    const child = createTerminal('child', 'root');
    const orphan = createTerminal('orphan', 'missing-parent');

    const result = buildTerminalTree([root, child, orphan]);

    expect(result).toHaveLength(3);

    // All three should be present
    const ids = result.map(n => n.terminal.terminalId);
    expect(ids).toContain('root');
    expect(ids).toContain('child');
    expect(ids).toContain('orphan');

    // Orphan should be at depth 0 (treated as root)
    expect(result.find(n => n.terminal.terminalId === 'orphan')?.depth).toBe(0);
  });

  it('maintains DFS order with multiple children', () => {
    const root = createTerminal('root', null);
    const child1 = createTerminal('child1', 'root');
    const child2 = createTerminal('child2', 'root');
    const grandchild1 = createTerminal('grandchild1', 'child1');

    const result = buildTerminalTree([root, child1, child2, grandchild1]);

    expect(result).toHaveLength(4);

    // DFS order: root -> child1 -> grandchild1 -> child2
    // (children visited in order they appear in input)
    const rootIdx = result.findIndex(n => n.terminal.terminalId === 'root');
    const child1Idx = result.findIndex(n => n.terminal.terminalId === 'child1');
    const grandchild1Idx = result.findIndex(n => n.terminal.terminalId === 'grandchild1');
    const child2Idx = result.findIndex(n => n.terminal.terminalId === 'child2');

    expect(rootIdx).toBe(0);
    expect(child1Idx).toBeGreaterThan(rootIdx);
    expect(grandchild1Idx).toBeGreaterThan(child1Idx);
    expect(grandchild1Idx).toBeLessThan(child2Idx); // DFS visits child1's subtree before child2
  });

  it('handles input order independence for parent-child', () => {
    // Child appears before parent in input
    const child = createTerminal('child', 'parent');
    const parent = createTerminal('parent', null);

    const result = buildTerminalTree([child, parent]);

    expect(result).toHaveLength(2);
    // Parent should still come first in output (DFS order)
    expect(result[0].terminal.terminalId).toBe('parent');
    expect(result[0].depth).toBe(0);
    expect(result[1].terminal.terminalId).toBe('child');
    expect(result[1].depth).toBe(1);
  });

  it('handles deeply nested hierarchy (4 levels)', () => {
    const level0 = createTerminal('level0', null);
    const level1 = createTerminal('level1', 'level0');
    const level2 = createTerminal('level2', 'level1');
    const level3 = createTerminal('level3', 'level2');

    const result = buildTerminalTree([level0, level1, level2, level3]);

    expect(result).toHaveLength(4);
    expect(result[0].depth).toBe(0);
    expect(result[1].depth).toBe(1);
    expect(result[2].depth).toBe(2);
    expect(result[3].depth).toBe(3);
  });
});
