import type { NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getSelection } from '@vt/graph-state/state/selectionStore'

import { applyLiveCommandToRenderer } from '@/shell/edge/UI-edge/graph/actions/applyLiveCommandToRenderer'

export interface RendererLiveStateSnapshot {
    selection: NodeIdAndFilePath[]
}

export function snapshotRendererLiveState(): RendererLiveStateSnapshot {
    return {
        selection: [...getSelection()],
    }
}

export async function applyRendererLiveCommand(
    command: unknown,
): Promise<RendererLiveStateSnapshot> {
    await applyLiveCommandToRenderer(command)
    return snapshotRendererLiveState()
}
