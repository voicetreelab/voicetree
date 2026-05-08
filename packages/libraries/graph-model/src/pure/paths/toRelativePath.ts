/**
 * Pure utility function to convert an absolute path to a relative path.
 *
 * @param projectRoot - Absolute path to the project root, or null if not set.
 * @param absolutePath - Absolute file path to convert.
 * @returns Relative path from project root, or original path if conversion not possible.
 */
export function toRelativePath(projectRoot: string | null, absolutePath: string): string {
    if (!projectRoot) {
        return absolutePath;
    }

    // Normalize paths to use forward slashes
    const normalizedAbsolutePath: string = absolutePath.replace(/\\/g, '/');
    const normalizedProjectRoot: string = projectRoot.replace(/\\/g, '/');

    // Check if absolutePath starts with project root path
    if (normalizedAbsolutePath.startsWith(normalizedProjectRoot + '/')) {
        return normalizedAbsolutePath.slice(normalizedProjectRoot.length + 1);
    }

    // If absolutePath doesn't start with project root, return as-is
    return absolutePath;
}
