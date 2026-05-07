import type { TerminalData, TerminalLifecycle } from './types';

/**
 * Aggregated child-lifecycle counts for a parent terminal. Used to render
 * a status summary chip when the parent is collapsed.
 *
 * Counts include the parent's full descendant subtree (recursive), not just
 * direct children — so a deep tree with one urgent grandchild surfaces an
 * `awaiting` count even when the immediate children are all idle.
 */
export type ChildStatusSummary = {
    readonly total: number;
    readonly spawning: number;
    readonly active: number;
    readonly idle: number;
    readonly awaiting: number;
    readonly completed: number;
    readonly errored: number;
};

const EMPTY_SUMMARY: ChildStatusSummary = Object.freeze({
    total: 0, spawning: 0, active: 0, idle: 0, awaiting: 0, completed: 0, errored: 0,
});

/**
 * A terminal with computed tree depth for display.
 *
 * `hasChildren` and `descendantSummary` are populated whenever a node has at
 * least one child in the source list (regardless of collapse state) — the
 * caller uses these to decide whether to render a chevron or summary chip.
 */
export type TerminalTreeNode = {
    readonly terminal: TerminalData;
    readonly depth: number;
    readonly hasChildren: boolean;
    readonly directChildCount: number;
    readonly descendantSummary: ChildStatusSummary;
};

/**
 * Predicate deciding whether a given parent should hide its descendants.
 * The React layer passes a function that consults user toggle state plus an
 * auto-collapse threshold; the tree builder stays pure and oblivious to that
 * policy.
 */
export type IsCollapsedFn = (
    parent: TerminalData,
    directChildCount: number,
) => boolean;

/**
 * Transform flat terminal list into tree-ordered list with depths.
 * Uses DFS traversal: parent appears before children.
 *
 * @param terminals - Flat array of TerminalData
 * @param isCollapsed - Optional predicate; when it returns true for a parent,
 *                     the parent is included but its descendants are omitted.
 * @returns Array of TerminalTreeNode in display order (parent, then children depth-first)
 */
export function buildTerminalTree(
    terminals: readonly TerminalData[],
    isCollapsed?: IsCollapsedFn,
): TerminalTreeNode[] {
    if (terminals.length === 0) return [];

    // Build map of terminalId -> terminal for lookup
    const terminalById: Map<string, TerminalData> = new Map<string, TerminalData>();
    for (const terminal of terminals) {
        terminalById.set(terminal.terminalId, terminal);
    }

    // Separate roots from children, grouping children by parent
    const childrenByParentId: Map<string, TerminalData[]> = new Map<string, TerminalData[]>();
    const rootTerminals: TerminalData[] = [];

    for (const terminal of terminals) {
        const parentId: string | null = terminal.parentTerminalId;
        const isRoot: boolean = parentId === null || !terminalById.has(parentId);

        if (isRoot) {
            rootTerminals.push(terminal);
        } else {
            // Has a valid parent — null-coalesced above guarantees parentId is non-null here.
            const list: TerminalData[] = childrenByParentId.get(parentId!) ?? [];
            list.push(terminal);
            childrenByParentId.set(parentId!, list);
        }
    }

    // Recursive descendant-summary computation. Memoised by terminalId so deep
    // trees don't re-walk shared subtrees (current shape is strict-tree so
    // memo is mainly defensive).
    const summaryCache: Map<string, ChildStatusSummary> = new Map<string, ChildStatusSummary>();
    function computeDescendantSummary(parent: TerminalData): ChildStatusSummary {
        const cached: ChildStatusSummary | undefined = summaryCache.get(parent.terminalId);
        if (cached) return cached;

        const children: readonly TerminalData[] = childrenByParentId.get(parent.terminalId) ?? [];
        if (children.length === 0) {
            summaryCache.set(parent.terminalId, EMPTY_SUMMARY);
            return EMPTY_SUMMARY;
        }

        let spawning: number = 0, active: number = 0, idle: number = 0;
        let awaiting: number = 0, completed: number = 0, errored: number = 0;
        let total: number = 0;

        for (const child of children) {
            total++;
            switch (child.lifecycle as TerminalLifecycle) {
                case 'spawning': spawning++; break;
                case 'active': active++; break;
                case 'idle': idle++; break;
                case 'awaiting_input': awaiting++; break;
                case 'completed': completed++; break;
                case 'errored': errored++; break;
            }
            // Add deeper descendants
            const sub: ChildStatusSummary = computeDescendantSummary(child);
            total += sub.total;
            spawning += sub.spawning;
            active += sub.active;
            idle += sub.idle;
            awaiting += sub.awaiting;
            completed += sub.completed;
            errored += sub.errored;
        }

        const summary: ChildStatusSummary = { total, spawning, active, idle, awaiting, completed, errored };
        summaryCache.set(parent.terminalId, summary);
        return summary;
    }

    // DFS from roots. When a node is collapsed, push the node itself but skip
    // its descendants.
    const result: TerminalTreeNode[] = [];

    function dfs(terminal: TerminalData, depth: number): void {
        const children: readonly TerminalData[] = childrenByParentId.get(terminal.terminalId) ?? [];
        const directChildCount: number = children.length;
        const hasChildren: boolean = directChildCount > 0;
        const descendantSummary: ChildStatusSummary = hasChildren
            ? computeDescendantSummary(terminal)
            : EMPTY_SUMMARY;

        result.push({ terminal, depth, hasChildren, directChildCount, descendantSummary });

        if (hasChildren && isCollapsed && isCollapsed(terminal, directChildCount)) {
            return; // Don't recurse — render the parent only.
        }

        for (const child of children) {
            dfs(child, depth + 1);
        }
    }

    for (const root of rootTerminals) {
        dfs(root, 0);
    }

    return result;
}
