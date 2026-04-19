import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph'
import { getCollapseSet } from '@vt/graph-state/state/collapseSetStore'
import { getSelection } from '@vt/graph-state/state/selectionStore'

import { applyLiveCommandToRenderer } from '@/shell/edge/UI-edge/graph/applyLiveCommandToRenderer'

export interface RendererLiveStateSnapshot {
    collapseSet: string[]
    selection: NodeIdAndFilePath[]
}

export function snapshotRendererLiveState(): RendererLiveStateSnapshot {
    return {
        collapseSet: [...getCollapseSet()],
        selection: [...getSelection()],
    }
}

export async function applyRendererLiveCommand(
    command: unknown,
): Promise<RendererLiveStateSnapshot> {
    await applyLiveCommandToRenderer(command)
    return snapshotRendererLiveState()
}
