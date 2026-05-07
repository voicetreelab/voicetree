/**
 * Retroactive Fair Rebalancing Spawn Budget Registry
 *
 * Each terminal tracks its own budget + per-parent state (originalBudget, children).
 * When a parent spawns child N:
 *   fairShare = floor((originalBudget - N) / N)
 *   All existing siblings are rebalanced: min(currentRemaining, fairShare)
 *   New child receives fairShare.
 *
 * Spawn guard: N <= originalBudget.
 * budget=undefined means unlimited (backward compatible).
 */

// Per-parent spawning state
type ParentState = {
    originalBudget: number
    spawnCount: number
    childrenIds: string[]
}

// Map of terminal ID -> remaining budget (what this terminal has available)
const terminalBudgets: Map<string, number> = new Map()

// Map of terminal ID -> parent state (for tracking children and rebalancing)
const parentStates: Map<string, ParentState> = new Map()

/**
 * Get the remaining budget for a terminal.
 * Returns undefined if no budget is set (unlimited spawning allowed).
 */
export function getTerminalBudget(terminalId: string): number | undefined {
    return terminalBudgets.get(terminalId)
}

/**
 * Set the spawn budget for a terminal and initialize its parent state.
 * Called when initializing a root terminal from GLOBAL_SPAWN_BUDGET env var,
 * or when a child terminal receives its allocated budget.
 */
export function setTerminalBudget(terminalId: string, budget: number): void {
    if (budget < 0) {
        console.warn(`[global-budget-registry] Attempted to set negative budget: ${budget}`)
        return
    }
    const floored: number = Math.floor(budget)
    terminalBudgets.set(terminalId, floored)
    parentStates.set(terminalId, { originalBudget: floored, spawnCount: 0, childrenIds: [] })
    console.log(`[global-budget-registry] Set budget for ${terminalId}: ${floored}`)
}

/**
 * Attempt to consume and split budget for spawning a child.
 *
 * Formula:
 *   N = spawnCount + 1  (total children after this spawn)
 *   fairShare = floor((originalBudget - N) / N)
 *   Existing children rebalanced: min(currentRemaining, fairShare)
 *
 * @returns { allowed, childBudget } — childBudget is undefined when no budget is set (unlimited).
 */
export function tryConsumeAndSplitBudget(callerTerminalId: string): { allowed: boolean; childBudget: number | undefined } {
    const state: ParentState | undefined = parentStates.get(callerTerminalId)

    // No parent state = no budget set = unlimited spawning (backward compatible)
    if (!state) {
        return { allowed: true, childBudget: undefined }
    }

    const newN: number = state.spawnCount + 1

    // Spawn guard: N <= originalBudget (each spawn costs 1, children get remainder)
    if (newN > state.originalBudget) {
        console.log(`[global-budget-registry] Budget exhausted for ${callerTerminalId}: spawnCount=${state.spawnCount}, originalBudget=${state.originalBudget}`)
        return { allowed: false, childBudget: undefined }
    }

    const fairShare: number = Math.floor((state.originalBudget - newN) / newN)

    // Rebalance existing children: cap at fairShare (never increase)
    for (const childId of state.childrenIds) {
        const currentRemaining: number | undefined = terminalBudgets.get(childId)
        if (currentRemaining !== undefined && currentRemaining > fairShare) {
            const reduction: number = currentRemaining - fairShare
            terminalBudgets.set(childId, fairShare)
            // Also reduce child's originalBudget so its own spawning is bounded correctly
            const childState: ParentState | undefined = parentStates.get(childId)
            if (childState) {
                childState.originalBudget = Math.max(0, childState.originalBudget - reduction)
            }
        }
    }

    state.spawnCount = newN
    console.log(`[global-budget-registry] Fair rebalance for ${callerTerminalId}: N=${newN}, fairShare=${fairShare}, originalBudget=${state.originalBudget}`)

    return { allowed: true, childBudget: fairShare }
}

/**
 * Register a spawned child with its parent for future rebalancing.
 * Called after spawn succeeds so the child can be rebalanced on subsequent sibling spawns.
 */
export function registerChild(parentTerminalId: string, childTerminalId: string): void {
    const state: ParentState | undefined = parentStates.get(parentTerminalId)
    if (state) {
        state.childrenIds.push(childTerminalId)
    }
}

/**
 * Remove the budget entry for a terminal.
 * Called when a terminal is removed from the registry to prevent memory leaks.
 */
export function clearBudget(terminalId: string): void {
    terminalBudgets.delete(terminalId)
    parentStates.delete(terminalId)
    // Remove from any parent's childrenIds
    for (const state of parentStates.values()) {
        const idx: number = state.childrenIds.indexOf(terminalId)
        if (idx !== -1) {
            state.childrenIds.splice(idx, 1)
        }
    }
}

/**
 * Clear all budgets. Used for testing.
 */
export function clearAllBudgets(): void {
    terminalBudgets.clear()
    parentStates.clear()
}

/**
 * Get all active budgets for debugging/monitoring.
 */
export function getAllBudgets(): ReadonlyMap<string, number> {
    return new Map(terminalBudgets)
}
