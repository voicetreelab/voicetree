import {tellSTTServerToLoadDirectory} from "@/shell/edge/main/backend-api.ts";
import type {FilePath} from "@/pure/graph";

/**
 * Notify the backend server about the directory being watched
 * This tells the backend which directory to use for markdown tree operations
 * Retries every 5 seconds until successful
 * @param directoryPath - Absolute path to the markdown tree directory
 */
export function notifyTextToTreeServerOfDirectory(directoryPath: FilePath): void {
    void attemptNotification(directoryPath);
}

/**
 * Attempt to notify backend, retrying every 5 seconds on failure
 */
async function attemptNotification(directoryPath: FilePath): Promise<void> {
    try {
        const response = await tellSTTServerToLoadDirectory(directoryPath);
        console.log(`[NotifyServer] Backend loaded ${response.nodes_loaded} nodes from ${response.directory}`);
    } catch (_error) {
        console.log('[NotifyServer] Failed to notify backend, will retry in 5 seconds...');
        setTimeout(() => void attemptNotification(directoryPath), 5000);
    }
}
