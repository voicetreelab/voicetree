import type { Delta, RequestFit, State } from '../contract'

const DEFAULT_FIT_PADDING_PX = 50

/**
 * BF-167 — RequestFit reducer. Records a fit request on `state.layout.fit`.
 * Always emits a delta so the renderer subscriber re-fits even when padding
 * matches the previous request (fit is a *gesture*, not stable state — same
 * paddingPx with new graph contents should still fire).
 */
export function applyRequestFit(
    state: State,
    command: RequestFit,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const paddingPx = command.paddingPx ?? DEFAULT_FIT_PADDING_PX
    const fit = { paddingPx } as const

    return {
        state: {
            ...state,
            layout: { ...state.layout, fit },
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            layoutChanged: { fit },
        },
    }
}
