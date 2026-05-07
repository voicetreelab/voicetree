import type { Delta, SetPositions, State } from '../contract'

/**
 * BF-167 — SetPositions reducer. Merges `command.positions` into
 * `state.layout.positions` by nodeId (last-wins per id). Entries equal to
 * the existing position are dropped from the delta to keep subscribers
 * idle. The full merged Map is also returned in `layoutChanged.positions`.
 */
export function applySetPositions(
    state: State,
    command: SetPositions,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const merged = new Map(state.layout.positions)
    const changed = new Map<string, { readonly x: number; readonly y: number }>()

    for (const [id, pos] of command.positions) {
        const current = merged.get(id)
        if (current?.x === pos.x && current?.y === pos.y) {
            continue
        }
        merged.set(id, pos)
        changed.set(id, pos)
    }

    if (changed.size === 0) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    return {
        state: {
            ...state,
            layout: { ...state.layout, positions: merged },
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            layoutChanged: { positions: changed },
        },
    }
}
