import type {FilePath} from '../pure/graph';
import {getCallbacks} from "../types";

/**
 * Notify the backend server about the directory being watched
 * This tells the backend which directory to use for markdown tree operations
 * Uses the notifyWriteDirectory callback (injected at init time) for headless compatibility.
 * @param directoryPath - Absolute path to the markdown tree directory
 */
export function notifyTextToTreeServerOfDirectory(directoryPath: FilePath): void {
    const callbacks = getCallbacks()
    callbacks.notifyWriteDirectory?.(directoryPath)
}
