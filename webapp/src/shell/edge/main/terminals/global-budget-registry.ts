/**
 * Global Spawn Budget Registry
 * 
 * Functional approach: budget stored only on root ancestors.
 * Children find root via getOldestAncestor() and check budget there.
 * 
 * This avoids duplicating state across all terminals and provides
 * a single source of truth for the global spawn budget.
 */

import {getTerminalRecords, type TerminalRecord} from './terminal-registry'

// Map of root terminal ID -> remaining budget
const rootBudgets: Map<string, number> = new Map()

/**
 * Get the oldest ancestor (root) of a terminal by walking the parent chain.
 * Detects cycles and returns null if found.
 * 
 * This is a pure function - it computes ancestry from existing parent links
 * rather than storing ancestor IDs on each terminal.
 */
export function getOldestAncestor(terminalId: string): TerminalRecord | null {
    const visited: Set<string> = new Set<string>()
    let current: TerminalRecord | undefined = getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )
    
    while (current?.terminalData.parentTerminalId) {
        // Cycle detection
        if (visited.has(current.terminalId)) {
            console.error(`[global-budget-registry] Cycle detected in parent chain at ${current.terminalId}`)
            return null
        }
        visited.add(current.terminalId)
        
        // Walk up to parent
        const parent: TerminalRecord | undefined = getTerminalRecords().find(
            (r: TerminalRecord) => r.terminalId === current!.terminalData.parentTerminalId
        )
        if (!parent) {
            // Parent reference exists but parent not found in registry
            console.warn(`[global-budget-registry] Parent ${current.terminalData.parentTerminalId} not found for ${current.terminalId}`)
            break
        }
        current = parent
    }
    
    return current ?? null
}

/**
 * Set the global spawn budget for a root terminal.
 * Should be called when spawning the root agent with GLOBAL_SPAWN_BUDGET env var.
 */
export function setRootBudget(rootTerminalId: string, budget: number): void {
    if (budget < 0) {
        console.warn(`[global-budget-registry] Attempted to set negative budget: ${budget}`)
        return
    }
    rootBudgets.set(rootTerminalId, Math.floor(budget))
    console.log(`[global-budget-registry] Set budget for ${rootTerminalId}: ${budget}`)
}

/**
 * Get the remaining budget for a root terminal.
 * Returns undefined if no budget is set (unlimited spawning allowed).
 */
export function getRootBudget(rootTerminalId: string): number | undefined {
    return rootBudgets.get(rootTerminalId)
}

/**
 * Decrement the budget for a root terminal.
 * Returns true if successful, false if budget exhausted or not set.
 * 
 * This is the core function called before spawning a child agent.
 */
export function decrementRootBudget(rootTerminalId: string, amount: number = 1): boolean {
    const current: number | undefined = rootBudgets.get(rootTerminalId)
    
    // No budget set = unlimited spawning (backward compatible)
    if (current === undefined) {
        return true
    }
    
    if (current < amount) {
        console.log(`[global-budget-registry] Budget exhausted for ${rootTerminalId}: ${current} < ${amount}`)
        return false
    }
    
    rootBudgets.set(rootTerminalId, current - amount)
    console.log(`[global-budget-registry] Decremented budget for ${rootTerminalId}: ${current} -> ${current - amount}`)
    return true
}

/**
 * Attempt to consume spawn budget for a terminal's root.
 * Decrements the root's budget if sufficient. This is the main entry point for spawnAgentTool.
 *
 * @param terminalId - The terminal attempting to spawn
 * @param amount - Number of children to spawn (default 1)
 * @returns true if spawn is allowed (budget decremented), false if budget exhausted
 */
export function tryConsumeSpawnBudget(terminalId: string, amount: number = 1): boolean {
    const ancestor: TerminalRecord | null = getOldestAncestor(terminalId)

    // No ancestor found - treat as root
    const rootId: string = ancestor?.terminalId ?? terminalId
    
    return decrementRootBudget(rootId, amount)
}

/**
 * Get the root terminal ID for a given terminal.
 * Useful for logging and debugging.
 */
export function getRootTerminalId(terminalId: string): string | null {
    const ancestor: TerminalRecord | null = getOldestAncestor(terminalId)
    return ancestor?.terminalId ?? terminalId
}

/**
 * Remove the budget entry for a root terminal.
 * Called when a terminal is removed from the registry to prevent memory leaks.
 */
export function clearBudget(rootTerminalId: string): void {
    rootBudgets.delete(rootTerminalId)
}

/**
 * Clear all budgets. Used for testing.
 */
export function clearAllBudgets(): void {
    rootBudgets.clear()
}

/**
 * Get all active budgets for debugging/monitoring.
 */
export function getAllBudgets(): ReadonlyMap<string, number> {
    return new Map(rootBudgets)
}
