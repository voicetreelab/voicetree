import {checkBackendHealth, loadDirectory} from "@/utils/backend-api.ts";
import type {FilePath} from "@/functional_graph/pure/types.ts";

/**
 * Wait for the backend server to be ready before making API calls
 * Polls the /health endpoint with exponential backoff
 * @returns true if backend is ready, false if timeout
 */
async function waitForBackendReady(): Promise<boolean> {
    const maxAttempts = 20;
    const delayMs = 500;

    console.log('[NotifyServer] Waiting for backend to be ready...');

    const attemptHealthCheck = async (attempt: number): Promise<boolean> => {
        return checkBackendHealth()
            .then(isHealthy => {
                if (isHealthy) {
                    console.log(`[NotifyServer] Backend is ready (attempt ${attempt}/${maxAttempts})`);
                    return true;
                }
                return false;
            })
            .catch(error => {
                console.log(`[NotifyServer] Backend health check failed (attempt ${attempt}/${maxAttempts}):`, error);
                return false;
            });
    };

    const attempts = Array.from({length: maxAttempts}, (_, i) => i + 1);

    // eslint-disable-next-line functional/no-loop-statements
    for (const attempt of attempts) {
        const isReady = await attemptHealthCheck(attempt);
        if (isReady) {
            return true;
        }

        // Wait before next attempt
        if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    console.warn('[NotifyServer] Backend did not become ready within timeout period');
    return false;
}

/**
 * Notify the backend server about the directory being watched
 * This tells the backend which directory to use for markdown tree operations
 * Fire-and-forget - does not block the caller
 * @param directoryPath - Absolute path to the markdown tree directory
 */
export function notifyTextToTreeServerOfDirectory(directoryPath: FilePath): void {
    // Fire and forget - run in background without blocking
    void (async () => {
        console.log(`[NotifyServer] Notifying backend to load directory: ${directoryPath}`);

        // Wait for backend to be ready first
        const isReady = await waitForBackendReady();
        if (!isReady) {
            console.warn('[NotifyServer] Backend not ready, skipping load-directory notification');
            return;
        }

        // Call the backend API
        return loadDirectory(directoryPath)
            .then(response => {
                console.log(`[NotifyServer] Backend loaded directory successfully:`, response);
                console.log(`[NotifyServer] Backend loaded ${response.nodes_loaded} nodes from ${response.directory}`);
            })
            .catch(error => {
                console.error('[NotifyServer] Failed to notify backend of directory:', error);
                console.warn('[NotifyServer] Continuing with file watching despite backend error');
                // Note: We continue with file watching even if backend notification fails
                // This allows the frontend to work independently
            });
    })();
}
