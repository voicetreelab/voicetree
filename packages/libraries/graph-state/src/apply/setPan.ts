import type { Delta, SetPan, State } from '../contract'

/**
 * BF-167 — SetPan reducer. Replaces `state.layout.pan` (last-wins).
 * No-op (still bumps revision) when the new pan equals the current pan.
 */
export function applySetPan(
    state: State,
    command: SetPan,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const current = state.layout.pan
    const unchanged = current !== undefined
        && current.x === command.pan.x
        && current.y === command.pan.y

    if (unchanged) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    return {
        state: {
            ...state,
            layout: { ...state.layout, pan: command.pan },
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            layoutChanged: { pan: command.pan },
        },
    }
}
