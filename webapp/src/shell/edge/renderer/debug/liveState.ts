import type { NodeIdAndFilePath } from '@vt/graph-model/pure/graph'
import { getSelection } from '@vt/graph-state/state/selectionStore'

import { applyLiveCommandToRenderer } from '@/shell/edge/UI-edge/graph/applyLiveCommandToRenderer'
import { getGraphCollapseSet } from '@/shell/edge/UI-edge/state/FolderTreeStore'

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
