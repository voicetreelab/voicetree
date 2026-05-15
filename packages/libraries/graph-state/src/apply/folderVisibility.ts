import type { SetFolderState, State } from '../contract'
import { setFolderState } from '../state/folderVisibilityStore'

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
