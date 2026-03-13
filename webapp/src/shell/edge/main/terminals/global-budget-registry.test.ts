import { describe, it, expect, beforeEach } from 'vitest';
import {
    setRootBudget,
    getRootBudget,
    decrementRootBudget,
    tryConsumeSpawnBudget,
    getOldestAncestor,
    getRootTerminalId,
    clearAllBudgets,
} from './global-budget-registry';
import { clearTerminalRecords, recordTerminalSpawn, type TerminalRecord } from './terminal-registry';
import { createTerminalData, type TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

describe('global-budget-registry', () => {
    beforeEach(() => {
        clearAllBudgets();
        clearTerminalRecords();
    });

    describe('setRootBudget', () => {
        it('should set budget for a root terminal', () => {
            setRootBudget('root-1', 100);
            expect(getRootBudget('root-1')).toBe(100);
        });

        it('should floor decimal budgets', () => {
            setRootBudget('root-1', 100.7);
            expect(getRootBudget('root-1')).toBe(100);
        });

        it('should ignore negative budgets', () => {
            setRootBudget('root-1', -10);
            expect(getRootBudget('root-1')).toBeUndefined();
        });
    });

    describe('decrementRootBudget', () => {
        it('should decrement budget and return true when sufficient', () => {
            setRootBudget('root-1', 10);
            const result: boolean = decrementRootBudget('root-1', 3);
            expect(result).toBe(true);
            expect(getRootBudget('root-1')).toBe(7);
        });

        it('should return false when budget exhausted', () => {
            setRootBudget('root-1', 2);
            const result: boolean = decrementRootBudget('root-1', 3);
            expect(result).toBe(false);
            expect(getRootBudget('root-1')).toBe(2); // Unchanged
        });

        it('should return true when no budget set (unlimited)', () => {
            const result: boolean = decrementRootBudget('root-1', 1);
            expect(result).toBe(true);
        });
    });

    describe('getOldestAncestor', () => {
        it('should return the terminal itself if no parent', () => {
            const terminalData: TerminalData = createMockTerminalData('root', null);
            recordTerminalSpawn('root', terminalData);

            const ancestor: TerminalRecord | null = getOldestAncestor('root');
            expect(ancestor?.terminalId).toBe('root');
        });

        it('should walk parent chain to find root', () => {
            // root -> child -> grandchild
            const rootData: TerminalData = createMockTerminalData('root', null);
            const childData: TerminalData = createMockTerminalData('child', 'root');
            const grandchildData: TerminalData = createMockTerminalData('grandchild', 'child');

            recordTerminalSpawn('root', rootData);
            recordTerminalSpawn('child', childData);
            recordTerminalSpawn('grandchild', grandchildData);

            const ancestor: TerminalRecord | null = getOldestAncestor('grandchild');
            expect(ancestor?.terminalId).toBe('root');
        });

        it('should detect cycles and return null', () => {
            // Create cycle: a -> b -> c -> a
            const aData: TerminalData = createMockTerminalData('a', 'c');
            const bData: TerminalData = createMockTerminalData('b', 'a');
            const cData: TerminalData = createMockTerminalData('c', 'b');

            recordTerminalSpawn('a', aData);
            recordTerminalSpawn('b', bData);
            recordTerminalSpawn('c', cData);

            const ancestor: TerminalRecord | null = getOldestAncestor('a');
            expect(ancestor).toBeNull();
        });
    });

    describe('tryConsumeSpawnBudget', () => {
        it('should allow spawn when budget is sufficient', () => {
            const rootData: TerminalData = createMockTerminalData('root', null);
            recordTerminalSpawn('root', rootData);
            setRootBudget('root', 5);

            const result: boolean = tryConsumeSpawnBudget('root', 3);
            expect(result).toBe(true);
            expect(getRootBudget('root')).toBe(2);
        });

        it('should deny spawn when budget exhausted', () => {
            const rootData: TerminalData = createMockTerminalData('root', null);
            const childData: TerminalData = createMockTerminalData('child', 'root');
            recordTerminalSpawn('root', rootData);
            recordTerminalSpawn('child', childData);
            setRootBudget('root', 1);

            // First spawn succeeds
            expect(tryConsumeSpawnBudget('child', 1)).toBe(true);

            // Second spawn fails
            expect(tryConsumeSpawnBudget('child', 1)).toBe(false);
        });

        it('should use root budget for child terminals', () => {
            const rootData: TerminalData = createMockTerminalData('root', null);
            const childData: TerminalData = createMockTerminalData('child', 'root');
            const grandchildData: TerminalData = createMockTerminalData('grandchild', 'child');

            recordTerminalSpawn('root', rootData);
            recordTerminalSpawn('child', childData);
            recordTerminalSpawn('grandchild', grandchildData);
            setRootBudget('root', 10);

            // Spawn from grandchild should use root's budget
            expect(tryConsumeSpawnBudget('grandchild', 5)).toBe(true);
            expect(getRootBudget('root')).toBe(5);
        });

        it('should allow unlimited spawning when no budget set', () => {
            const rootData: TerminalData = createMockTerminalData('root', null);
            recordTerminalSpawn('root', rootData);

            expect(tryConsumeSpawnBudget('root', 100)).toBe(true);
            expect(tryConsumeSpawnBudget('root', 100)).toBe(true);
        });
    });

    describe('getRootTerminalId', () => {
        it('should return root ID for child terminals', () => {
            const rootData: TerminalData = createMockTerminalData('root', null);
            const childData: TerminalData = createMockTerminalData('child', 'root');

            recordTerminalSpawn('root', rootData);
            recordTerminalSpawn('child', childData);

            expect(getRootTerminalId('child')).toBe('root');
        });

        it('should return self for root terminals', () => {
            const rootData: TerminalData = createMockTerminalData('root', null);
            recordTerminalSpawn('root', rootData);

            expect(getRootTerminalId('root')).toBe('root');
        });
    });
});

// Helper function to create mock TerminalData using the real factory
function createMockTerminalData(
    terminalId: string,
    parentTerminalId: string | null
): TerminalData {
    return createTerminalData({
        terminalId: terminalId as TerminalId,
        attachedToNodeId: `/test/${terminalId}.md`,
        terminalCount: 0,
        title: `Test ${terminalId}`,
        executeCommand: true,
        agentName: terminalId,
        parentTerminalId: parentTerminalId as TerminalId | null,
    });
}
