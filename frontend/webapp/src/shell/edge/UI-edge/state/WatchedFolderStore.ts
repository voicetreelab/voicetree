/**
 * Store for watched folder path in renderer process.
 *
 * This store holds the current watched folder path, allowing UI components
 * and extensions (like wikilinkCompletion) to compute relative paths.
 */

// Current watched folder path (absolute path to project root)
let watchedFolder: string | null = null;

/**
 * Get the current watched folder path.
 * @returns Absolute path to watched folder, or null if not set.
 */
export function getWatchedFolder(): string | null {
    return watchedFolder;
}

/**
 * Set the watched folder path.
 * Called when folder watching starts.
 */
export function setWatchedFolder(folderPath: string | null): void {
    watchedFolder = folderPath;
}

/**
 * Convert an absolute node ID to a path relative to the watched folder.
 * @param nodeId - Absolute file path (node ID)
 * @returns Relative path from watched folder, or original nodeId if conversion not possible
 */
export function toRelativePath(nodeId: string): string {
    if (!watchedFolder) {
        return nodeId;
    }

    // Normalize paths to use forward slashes
    const normalizedNodeId = nodeId.replace(/\\/g, '/');
    const normalizedWatchedFolder = watchedFolder.replace(/\\/g, '/');

    // Check if nodeId starts with watched folder path
    if (normalizedNodeId.startsWith(normalizedWatchedFolder + '/')) {
        return normalizedNodeId.slice(normalizedWatchedFolder.length + 1);
    }

    // If nodeId doesn't start with watched folder, return as-is
    return nodeId;
}
