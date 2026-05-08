import { describe, it, expect, beforeEach } from 'vitest';
import {
    setTerminalBudget,
    getTerminalBudget,
    tryConsumeAndSplitBudget,
    registerChild,
    clearAllBudgets,
    clearBudget,
    getAllBudgets,
} from './global-budget-registry';

describe('global-budget-registry (retroactive fair rebalancing)', () => {
    beforeEach(() => {
        clearAllBudgets();
    });

    describe('setTerminalBudget / getTerminalBudget', () => {
        it('should set and get budget for a terminal', () => {
            setTerminalBudget('t-1', 100);
            expect(getTerminalBudget('t-1')).toBe(100);
        });

        it('should floor decimal budgets', () => {
            setTerminalBudget('t-1', 10.7);
            expect(getTerminalBudget('t-1')).toBe(10);
        });

        it('should ignore negative budgets', () => {
            setTerminalBudget('t-1', -5);
            expect(getTerminalBudget('t-1')).toBeUndefined();
        });

        it('should return undefined for unregistered terminals', () => {
            expect(getTerminalBudget('nonexistent')).toBeUndefined();
        });
    });

    describe('tryConsumeAndSplitBudget', () => {
        it('budget=10, spawn 1 child -> child gets 9', () => {
            setTerminalBudget('parent', 10);
            const result: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(result.allowed).toBe(true);
            expect(result.childBudget).toBe(9); // floor((10-1)/1) = 9
        });

        it('budget=10, spawn 2 children -> each gets 4, first child rebalanced from 9 to 4', () => {
            setTerminalBudget('parent', 10);

            // First spawn: child1 gets 9
            const r1: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r1.childBudget).toBe(9);
            setTerminalBudget('child1', 9);
            registerChild('parent', 'child1');

            // Second spawn: N=2, fairShare=floor((10-2)/2)=4
            const r2: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r2.allowed).toBe(true);
            expect(r2.childBudget).toBe(4);

            // child1 rebalanced from 9 to 4
            expect(getTerminalBudget('child1')).toBe(4);
        });

        it('budget=10, spawn 2, first child spent 3 (remaining 6) -> rebalance to min(6, 4) = 4', () => {
            setTerminalBudget('parent', 10);

            // First spawn: child1 gets 9
            tryConsumeAndSplitBudget('parent');
            setTerminalBudget('child1', 9);
            registerChild('parent', 'child1');

            // Simulate child1 spending 3: remaining goes from 9 to 6
            setTerminalBudget('child1', 6);
            // Re-register child1 with parent (setTerminalBudget resets parentState but parent's childrenIds is separate)
            // Note: parent's childrenIds still has 'child1' from the registerChild call above

            // Second spawn: fairShare=4, child1 rebalanced to min(6, 4) = 4
            const r2: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r2.allowed).toBe(true);
            expect(r2.childBudget).toBe(4);
            expect(getTerminalBudget('child1')).toBe(4);
        });

        it('budget=10, spawn 2, first child spent 8 (remaining 1) -> rebalance to min(1, 4) = 1', () => {
            setTerminalBudget('parent', 10);

            // First spawn
            tryConsumeAndSplitBudget('parent');
            setTerminalBudget('child1', 9);
            registerChild('parent', 'child1');

            // Simulate child1 spending 8: remaining = 1
            setTerminalBudget('child1', 1);

            // Second spawn: fairShare=4, child1 stays at min(1, 4) = 1 (below fair share)
            const r2: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r2.allowed).toBe(true);
            expect(r2.childBudget).toBe(4);
            expect(getTerminalBudget('child1')).toBe(1); // not increased
        });

        it('budget=1 -> can spawn 1 child with budget 0', () => {
            setTerminalBudget('parent', 1);
            const result: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(result.allowed).toBe(true);
            expect(result.childBudget).toBe(0); // floor((1-1)/1) = 0
        });

        it('budget=0 -> cannot spawn', () => {
            setTerminalBudget('parent', 0);
            const result: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(result.allowed).toBe(false);
        });

        it('budget=undefined -> unlimited (allowed, childBudget undefined)', () => {
            const result: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(result.allowed).toBe(true);
            expect(result.childBudget).toBeUndefined();
        });

        it('budget=16, spawn 4 children -> conservation holds', () => {
            setTerminalBudget('parent', 16);

            // child1: N=1, fairShare=floor((16-1)/1)=15
            const r1: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r1.childBudget).toBe(15);
            setTerminalBudget('child1', 15);
            registerChild('parent', 'child1');

            // child2: N=2, fairShare=floor((16-2)/2)=7
            const r2: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r2.childBudget).toBe(7);
            expect(getTerminalBudget('child1')).toBe(7); // rebalanced
            setTerminalBudget('child2', 7);
            registerChild('parent', 'child2');

            // child3: N=3, fairShare=floor((16-3)/3)=4
            const r3: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r3.childBudget).toBe(4);
            expect(getTerminalBudget('child1')).toBe(4); // rebalanced
            expect(getTerminalBudget('child2')).toBe(4); // rebalanced
            setTerminalBudget('child3', 4);
            registerChild('parent', 'child3');

            // child4: N=4, fairShare=floor((16-4)/4)=3
            const r4: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r4.childBudget).toBe(3);
            expect(getTerminalBudget('child1')).toBe(3);
            expect(getTerminalBudget('child2')).toBe(3);
            expect(getTerminalBudget('child3')).toBe(3);

            // Conservation: 4 spawn costs + 4*3 = 16 ✓
        });

        it('exhausts budget after spawning originalBudget children', () => {
            setTerminalBudget('parent', 3);

            // Spawn 3 children (each gets 0 eventually)
            const r1: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r1.allowed).toBe(true);
            setTerminalBudget('child1', r1.childBudget!);
            registerChild('parent', 'child1');

            const r2: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r2.allowed).toBe(true);
            setTerminalBudget('child2', r2.childBudget!);
            registerChild('parent', 'child2');

            const r3: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r3.allowed).toBe(true);
            expect(r3.childBudget).toBe(0); // floor((3-3)/3) = 0

            // 4th spawn denied
            const r4: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r4.allowed).toBe(false);
        });
    });

    describe('clearBudget', () => {
        it('should remove budget and parent state for a terminal', () => {
            setTerminalBudget('t-1', 10);
            clearBudget('t-1');
            expect(getTerminalBudget('t-1')).toBeUndefined();
        });

        it('should remove terminal from parent childrenIds', () => {
            setTerminalBudget('parent', 10);
            tryConsumeAndSplitBudget('parent');
            setTerminalBudget('child1', 9);
            registerChild('parent', 'child1');

            clearBudget('child1');

            // Spawn again — should not try to rebalance child1
            const r2: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget('parent');
            expect(r2.allowed).toBe(true);
            // N=2, fairShare=floor((10-2)/2)=4 — no rebalancing since child1 was removed
            expect(r2.childBudget).toBe(4);
        });
    });

    describe('getAllBudgets', () => {
        it('should return all active budgets', () => {
            setTerminalBudget('t-1', 10);
            setTerminalBudget('t-2', 5);
            const budgets: ReadonlyMap<string, number> = getAllBudgets();
            expect(budgets.size).toBe(2);
            expect(budgets.get('t-1')).toBe(10);
            expect(budgets.get('t-2')).toBe(5);
        });
    });
});
