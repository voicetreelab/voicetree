import type { NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getSelection } from '@vt/graph-state/state/selectionStore'

import { applyLiveCommandToRenderer } from '@/shell/edge/UI-edge/graph/actions/applyLiveCommandToRenderer'
import { getGraphCollapseSet } from '@/shell/edge/UI-edge/state/stores/FolderTreeStore'

export interface RendererLiveStateSnapshot {
    collapseSet: string[]
    selection: NodeIdAndFilePath[]
}

export function snapshotRendererLiveState(): RendererLiveStateSnapshot {
    return {
        collapseSet: [...getGraphCollapseSet()],
        selection: [...getSelection()],
    }
}

export async function applyRendererLiveCommand(
    command: unknown,
): Promise<RendererLiveStateSnapshot> {
    await applyLiveCommandToRenderer(command)
    return snapshotRendererLiveState()
}
