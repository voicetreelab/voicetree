/**
 * Tests for tree-style agent tabs pure functions
 * TDD: These tests should fail initially, then pass after implementation
 */
import { describe, it, expect } from 'vitest';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminalDepth, buildTreeDisplayOrder } from './index';

// Helper to create minimal terminal-like objects for testing
// Only includes fields relevant to tree logic
type TestTerminal = {
    readonly id: TerminalId;
    readonly parentTerminalId: TerminalId | null;
};

const createTestTerminal = (id: string, parentId: string | null = null): TestTerminal => ({
    id: id as TerminalId,
    parentTerminalId: parentId as TerminalId | null,
});

// Create a Map from an array of test terminals
const terminalsToMap = (terminals: readonly TestTerminal[]): ReadonlyMap<TerminalId, TestTerminal> =>
    new Map(terminals.map(t => [t.id, t]));

describe('getTerminalDepth', () => {
    describe('basic depth calculation', () => {
        it('should return 0 for root terminals (no parent)', () => {
            const terminals = terminalsToMap([
                createTestTerminal('root1'),
                createTestTerminal('root2'),
            ]);

            expect(getTerminalDepth('root1' as TerminalId, terminals)).toBe(0);
            expect(getTerminalDepth('root2' as TerminalId, terminals)).toBe(0);
        });

        it('should return 1 for direct child of root', () => {
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child', 'root'),
            ]);

            expect(getTerminalDepth('child' as TerminalId, terminals)).toBe(1);
        });

        it('should return increasing depth for nested children', () => {
            // root -> child1 -> child2 -> child3
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child1', 'root'),
                createTestTerminal('child2', 'child1'),
                createTestTerminal('child3', 'child2'),
            ]);

            expect(getTerminalDepth('root' as TerminalId, terminals)).toBe(0);
            expect(getTerminalDepth('child1' as TerminalId, terminals)).toBe(1);
            expect(getTerminalDepth('child2' as TerminalId, terminals)).toBe(2);
            expect(getTerminalDepth('child3' as TerminalId, terminals)).toBe(3);
        });
    });

    describe('orphan handling', () => {
        it('should return 0 for orphaned terminals (parent not in map)', () => {
            // child's parent is not in the map (parent was closed)
            const terminals = terminalsToMap([
                createTestTerminal('orphan', 'deleted-parent'),
            ]);

            expect(getTerminalDepth('orphan' as TerminalId, terminals)).toBe(0);
        });

        it('should return correct depth when intermediate parent is missing', () => {
            // root -> (missing) -> child
            // child should become root (depth 0)
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child', 'missing-parent'),
            ]);

            expect(getTerminalDepth('child' as TerminalId, terminals)).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('should return 0 for non-existent terminal ID', () => {
            const terminals = terminalsToMap([
                createTestTerminal('root'),
            ]);

            expect(getTerminalDepth('non-existent' as TerminalId, terminals)).toBe(0);
        });

        it('should return 0 for empty terminals map', () => {
            const terminals = terminalsToMap([]);

            expect(getTerminalDepth('any' as TerminalId, terminals)).toBe(0);
        });

        it('should handle circular references without infinite loop', () => {
            // Defensive: if somehow parent references form a cycle
            // a -> b -> a (cycle)
            const terminals = terminalsToMap([
                createTestTerminal('a', 'b'),
                createTestTerminal('b', 'a'),
            ]);

            // Should not hang, and return a reasonable depth
            const depthA = getTerminalDepth('a' as TerminalId, terminals);
            const depthB = getTerminalDepth('b' as TerminalId, terminals);

            // Both should have finite depth
            expect(depthA).toBeLessThan(100);
            expect(depthB).toBeLessThan(100);
        });
    });
});

describe('buildTreeDisplayOrder', () => {
    describe('basic tree ordering', () => {
        it('should return empty array for empty input', () => {
            const terminals = terminalsToMap([]);

            const result = buildTreeDisplayOrder(terminals);

            expect(result).toEqual([]);
        });

        it('should return single terminal for single input', () => {
            const terminals = terminalsToMap([
                createTestTerminal('root'),
            ]);

            const result = buildTreeDisplayOrder(terminals);

            expect(result.map(t => t.id)).toEqual(['root' as TerminalId]);
        });

        it('should place children immediately after their parent', () => {
            // root has two children
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child1', 'root'),
                createTestTerminal('child2', 'root'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            // Root should come first
            expect(ids[0]).toBe('root' as TerminalId);
            // Children should come after root
            expect(ids.indexOf('child1' as TerminalId)).toBeGreaterThan(ids.indexOf('root' as TerminalId));
            expect(ids.indexOf('child2' as TerminalId)).toBeGreaterThan(ids.indexOf('root' as TerminalId));
        });

        it('should maintain nested hierarchy in display order', () => {
            // root -> child1 -> grandchild
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child1', 'root'),
                createTestTerminal('grandchild', 'child1'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            // Order should be: root, child1, grandchild (DFS order)
            const rootIdx = ids.indexOf('root' as TerminalId);
            const child1Idx = ids.indexOf('child1' as TerminalId);
            const grandchildIdx = ids.indexOf('grandchild' as TerminalId);

            expect(rootIdx).toBeLessThan(child1Idx);
            expect(child1Idx).toBeLessThan(grandchildIdx);
        });

        it('should handle multiple root terminals with their subtrees', () => {
            // root1 -> child1a, child1b
            // root2 -> child2a
            const terminals = terminalsToMap([
                createTestTerminal('root1'),
                createTestTerminal('child1a', 'root1'),
                createTestTerminal('child1b', 'root1'),
                createTestTerminal('root2'),
                createTestTerminal('child2a', 'root2'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            // Children should appear after their respective parents
            expect(ids.indexOf('child1a' as TerminalId)).toBeGreaterThan(ids.indexOf('root1' as TerminalId));
            expect(ids.indexOf('child1b' as TerminalId)).toBeGreaterThan(ids.indexOf('root1' as TerminalId));
            expect(ids.indexOf('child2a' as TerminalId)).toBeGreaterThan(ids.indexOf('root2' as TerminalId));

            // Children of root1 should appear before root2's subtree starts
            // (assuming roots maintain their original order)
            const root1Idx = ids.indexOf('root1' as TerminalId);
            const root2Idx = ids.indexOf('root2' as TerminalId);

            // All of root1's subtree should be between root1 and root2
            expect(ids.indexOf('child1a' as TerminalId)).toBeGreaterThan(root1Idx);
            expect(ids.indexOf('child1b' as TerminalId)).toBeGreaterThan(root1Idx);
            if (root1Idx < root2Idx) {
                expect(ids.indexOf('child1a' as TerminalId)).toBeLessThan(root2Idx);
                expect(ids.indexOf('child1b' as TerminalId)).toBeLessThan(root2Idx);
            }
        });
    });

    describe('orphan handling', () => {
        it('should treat orphaned terminals as roots', () => {
            // orphan's parent doesn't exist in the map
            const terminals = terminalsToMap([
                createTestTerminal('orphan', 'deleted-parent'),
                createTestTerminal('real-root'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            // Both should be at root level (no particular order required)
            expect(ids.length).toBe(2);
            expect(ids).toContain('orphan' as TerminalId);
            expect(ids).toContain('real-root' as TerminalId);
        });

        it('should preserve orphan children when parent is removed', () => {
            // Scenario: parent closes, children remain
            // Before: root -> child1, child2
            // After (parent removed): child1, child2 (both orphaned roots)
            const terminals = terminalsToMap([
                createTestTerminal('child1', 'deleted-root'),
                createTestTerminal('child2', 'deleted-root'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            expect(ids.length).toBe(2);
            expect(ids).toContain('child1' as TerminalId);
            expect(ids).toContain('child2' as TerminalId);
        });
    });

    describe('complex scenarios', () => {
        it('should handle deep nesting (3+ levels)', () => {
            // root -> l1 -> l2 -> l3 -> l4
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('l1', 'root'),
                createTestTerminal('l2', 'l1'),
                createTestTerminal('l3', 'l2'),
                createTestTerminal('l4', 'l3'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            // Should maintain strict hierarchy order
            for (let i = 0; i < ids.length - 1; i++) {
                expect(ids.indexOf(ids[i])).toBeLessThan(ids.indexOf(ids[i + 1]));
            }
        });

        it('should handle mixed orphans and valid trees', () => {
            // Valid tree: root -> child
            // Orphan: orphan-child (parent deleted)
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child', 'root'),
                createTestTerminal('orphan-child', 'deleted-parent'),
            ]);

            const result = buildTreeDisplayOrder(terminals);
            const ids = result.map(t => t.id);

            expect(ids.length).toBe(3);
            // child should follow root
            expect(ids.indexOf('child' as TerminalId)).toBeGreaterThan(ids.indexOf('root' as TerminalId));
        });
    });

    describe('stability', () => {
        it('should produce consistent output for same input', () => {
            const terminals = terminalsToMap([
                createTestTerminal('root'),
                createTestTerminal('child1', 'root'),
                createTestTerminal('child2', 'root'),
            ]);

            const result1 = buildTreeDisplayOrder(terminals);
            const result2 = buildTreeDisplayOrder(terminals);

            expect(result1.map(t => t.id)).toEqual(result2.map(t => t.id));
        });
    });
});
