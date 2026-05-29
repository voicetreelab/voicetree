/**
 * Push-based project path state store.
 * Main process pushes state updates via uiAPI.syncProjectState().
 * Renderer subscribes via useSyncExternalStore.
 *
 * Follows the same pattern as TerminalStore.ts.
 */

export interface ProjectPathState {
    readonly readPaths: readonly string[];
    readonly writeFolderPath: string | null;
    readonly starredFolders: readonly string[];
}

const INITIAL_STATE: ProjectPathState = {
    readPaths: [],
    writeFolderPath: null,
    starredFolders: [],
};

let currentState: ProjectPathState = INITIAL_STATE;

type ProjectPathCallback = (state: ProjectPathState) => void;
const subscribers: Set<ProjectPathCallback> = new Set();

function notifySubscribers(): void {
    for (const callback of subscribers) {
        callback(currentState);
    }
}

/**
 * Sync project path state from main process.
 * Called via uiAPI.syncProjectState() from main process after any project mutation.
 */
export function syncProjectStateFromMain(state: ProjectPathState): void {
    currentState = state;
    notifySubscribers();
}

/**
 * Subscribe to project path state changes.
 * @returns unsubscribe function
 */
export function subscribeToProjectPaths(callback: ProjectPathCallback): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

/**
 * Get current project path state snapshot.
 * For use with useSyncExternalStore.
 */
export function getProjectState(): ProjectPathState {
    return currentState;
}
