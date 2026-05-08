import type { Delta, SetZoom, State } from '../contract'

/**
 * BF-167 — SetZoom reducer. Replaces `state.layout.zoom` (last-wins).
 * No-op (still bumps revision) when the new zoom equals the current zoom;
 * `layoutChanged` is omitted in that case so subscribers can skip render.
 */
export function applySetZoom(
    state: State,
    command: SetZoom,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const unchanged = state.layout.zoom === command.zoom

    if (unchanged) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    return {
        state: {
            ...state,
            layout: { ...state.layout, zoom: command.zoom },
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            layoutChanged: { zoom: command.zoom },
        },
    }
}
