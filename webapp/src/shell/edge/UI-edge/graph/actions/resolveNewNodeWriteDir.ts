/**
 * Resolves the directory a new orphan node should be written into when the user
 * adds a node from the graph UI.
 *
 * Prefers the folder the user clicked inside. Folder node ids are absolute directory
 * paths carrying a trailing slash (e.g. `/proj/notes/`); the trailing slash is stripped
 * so the result matches the `writeFolderPath` convention consumed by
 * `createNewNodeNoParent` (e.g. `/proj/notes`). When the click was not inside any folder
 * — or the clicked id degenerates to empty — falls back to the project-wide write folder,
 * preserving the previous "always write to writeFolderPath" behaviour.
 *
 * This lives in the webapp UI-edge (not graph-model) because it interprets a *click*:
 * graph-model has no notion of where the user clicked.
 *
 * @param clickedFolderId - Folder node id under the click site, or undefined when the
 *                          click landed on empty canvas.
 * @param writeFolderPath - Absolute path to the project's write directory (no trailing slash).
 */
export function resolveNewNodeWriteDir(
    clickedFolderId: string | undefined,
    writeFolderPath: string,
): string {
    if (clickedFolderId === undefined) return writeFolderPath
    const stripped: string = clickedFolderId.replace(/\/+$/, '')
    return stripped === '' ? writeFolderPath : stripped
}
