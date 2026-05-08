import type { State } from '../contract'
import { setFolderState } from '../state/folderVisibilityStore'
import type {
    AbsolutePath,
    FolderState,
} from '../state/folderVisibility/types'

export interface SetFolderState {
    readonly type: 'SetFolderState'
    readonly viewId: string
    readonly path: AbsolutePath
    readonly state: FolderState
}

export function applySetFolderState(
    state: State,
    command: SetFolderState,
): State {
    setFolderState(command.viewId, command.path, command.state)
    return {
        ...state,
        meta: {
            ...state.meta,
            revision: state.meta.revision + 1,
        },
    }
}
