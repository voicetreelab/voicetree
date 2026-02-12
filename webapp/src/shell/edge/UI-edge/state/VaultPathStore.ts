/**
 * Push-based vault path state store.
 * Main process pushes state updates via uiAPI.syncVaultState().
 * Renderer subscribes via useSyncExternalStore.
 *
 * Follows the same pattern as TerminalStore.ts.
 */

export interface VaultPathState {
    readonly readPaths: readonly string[];
    readonly writePath: string | null;
    readonly starredFolders: readonly string[];
}

const INITIAL_STATE: VaultPathState = {
    readPaths: [],
    writePath: null,
    starredFolders: [],
};

let currentState: VaultPathState = INITIAL_STATE;

type VaultPathCallback = (state: VaultPathState) => void;
const subscribers: Set<VaultPathCallback> = new Set();

function notifySubscribers(): void {
    for (const callback of subscribers) {
        callback(currentState);
    }
}

/**
 * Sync vault path state from main process.
 * Called via uiAPI.syncVaultState() from main process after any vault mutation.
 */
export function syncVaultStateFromMain(state: VaultPathState): void {
    currentState = state;
    notifySubscribers();
}

/**
 * Subscribe to vault path state changes.
 * @returns unsubscribe function
 */
export function subscribeToVaultPaths(callback: VaultPathCallback): () => void {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}

/**
 * Get current vault path state snapshot.
 * For use with useSyncExternalStore.
 */
export function getVaultState(): VaultPathState {
    return currentState;
}
