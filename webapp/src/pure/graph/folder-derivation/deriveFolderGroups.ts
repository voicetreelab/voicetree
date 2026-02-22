import type { FolderPath, FolderGroup, FolderStructure } from './types';
import { isImageNode } from '@/pure/graph/isImageNode';

/**
 * Extract the immediate parent folder path from a node ID.
 * "auth/login.md" → "auth/"
 * "a/b/c/x.md" → "a/b/c/"
 * "readme.md" → null (no folder)
 */
function getDirectFolderPath(nodeId: string): FolderPath | null {
    const lastSlash: number = nodeId.lastIndexOf('/');
    if (lastSlash === -1) return null;
    return nodeId.slice(0, lastSlash + 1);
}

/**
 * Compute the depth of a folder path (number of path segments).
 * "auth/" → 1
 * "a/b/" → 2
 * "a/b/c/" → 3
 */
function getFolderDepth(folderPath: FolderPath): number {
    return folderPath.split('/').filter((s: string) => s.length > 0).length;
}

/**
 * Get all ancestor folder paths for a given folder path.
 * "a/b/c/" → ["a/", "a/b/"]
 */
function getAncestorPaths(folderPath: FolderPath): readonly FolderPath[] {
    const segments: readonly string[] = folderPath.split('/').filter((s: string) => s.length > 0);
    // Build each prefix except the last (which is folderPath itself)
    return segments.slice(0, -1).map((_: string, i: number) =>
        segments.slice(0, i + 1).join('/') + '/'
    );
}

/**
 * Classify a node ID into its target bucket: a folder path, 'root', or 'excluded'.
 */
function classifyNode(
    nodeId: string,
    excludePrefixes: readonly string[]
): { readonly type: 'folder'; readonly folderPath: FolderPath } | { readonly type: 'root' } {
    if (isImageNode(nodeId)) return { type: 'root' };

    const folderPath: FolderPath | null = getDirectFolderPath(nodeId);
    if (folderPath === null) return { type: 'root' };

    const isExcluded: boolean = excludePrefixes.some(
        (prefix: string) => folderPath === prefix || folderPath.startsWith(prefix)
    );
    if (isExcluded) return { type: 'root' };

    return { type: 'folder', folderPath };
}

/**
 * Derive folder groups from a set of node IDs. Pure function.
 *
 * Groups nodes by their immediate path prefix. A folder qualifies only if it
 * has >= 2 direct child FILES (subfolders don't count toward the minimum).
 * Image nodes are excluded from folder membership.
 *
 * @param nodeIds - All current node IDs (deletions should already be filtered out)
 * @param excludePrefixes - Folder prefixes to exclude (e.g. ['ctx-nodes/'])
 */
export function deriveFolderGroups(
    nodeIds: readonly string[],
    excludePrefixes: readonly string[] = []
): FolderStructure {
    // Step 1: Classify each node as root or belonging to a folder
    const classified: readonly { readonly nodeId: string; readonly classification: ReturnType<typeof classifyNode> }[] =
        nodeIds.map((nodeId: string) => ({ nodeId, classification: classifyNode(nodeId, excludePrefixes) }));

    const rootNodes: readonly string[] = classified
        .filter((c: { readonly nodeId: string; readonly classification: ReturnType<typeof classifyNode> }) => c.classification.type === 'root')
        .map((c: { readonly nodeId: string; readonly classification: ReturnType<typeof classifyNode> }) => c.nodeId);

    // Step 2: Group folder-classified nodes by their direct parent folder
    const folderEntries: readonly { readonly nodeId: string; readonly folderPath: FolderPath }[] = classified
        .filter((c: { readonly nodeId: string; readonly classification: ReturnType<typeof classifyNode> }) => c.classification.type === 'folder')
        .map((c: { readonly nodeId: string; readonly classification: ReturnType<typeof classifyNode> }) => ({
            nodeId: c.nodeId,
            folderPath: (c.classification as { readonly type: 'folder'; readonly folderPath: FolderPath }).folderPath,
        }));

    const folderToDirectFiles: ReadonlyMap<FolderPath, readonly string[]> = folderEntries.reduce<ReadonlyMap<FolderPath, readonly string[]>>(
        (acc: ReadonlyMap<FolderPath, readonly string[]>, entry: { readonly nodeId: string; readonly folderPath: FolderPath }) => {
            const existing: readonly string[] | undefined = acc.get(entry.folderPath);
            return new Map([...acc, [entry.folderPath, existing ? [...existing, entry.nodeId] : [entry.nodeId]]]);
        },
        new Map<FolderPath, readonly string[]>()
    );

    // Step 3: Filter to folders with >= 2 direct child files
    const qualifyingEntries: readonly (readonly [FolderPath, readonly string[]])[] = [...folderToDirectFiles.entries()]
        .filter(([, children]: readonly [FolderPath, readonly string[]]) => children.length >= 2);
    const qualifyingFolders: ReadonlyMap<FolderPath, readonly string[]> = new Map(qualifyingEntries);

    // Step 4: Compute parent relationships and build FolderGroups
    const sortedPaths: readonly FolderPath[] = [...qualifyingFolders.keys()].sort(
        (a: FolderPath, b: FolderPath) => getFolderDepth(a) - getFolderDepth(b)
    );

    const folderGroups: readonly FolderGroup[] = sortedPaths.map((folderPath: FolderPath) => {
        const childNodeIds: readonly string[] = qualifyingFolders.get(folderPath)!;
        const ancestors: readonly FolderPath[] = getAncestorPaths(folderPath);

        // Walk ancestors from deepest to shallowest to find nearest qualifying ancestor
        const parentFolderPath: FolderPath | null = ancestors
            .slice()
            .reverse()
            .find((ancestor: FolderPath) => qualifyingFolders.has(ancestor)) ?? null;

        return {
            folderPath,
            childNodeIds,
            parentFolderPath,
            depth: getFolderDepth(folderPath),
        };
    });

    const folders: ReadonlyMap<FolderPath, FolderGroup> = new Map(
        folderGroups.map((g: FolderGroup) => [g.folderPath, g] as const)
    );

    const nodeToFolder: ReadonlyMap<string, FolderPath> = new Map(
        folderGroups.flatMap((g: FolderGroup) =>
            g.childNodeIds.map((nodeId: string) => [nodeId, g.folderPath] as const)
        )
    );

    // Step 5: Collect remaining root nodes (nodes in non-qualifying folders)
    const nonQualifyingRoots: readonly string[] = [...folderToDirectFiles.entries()]
        .filter(([folderPath]: readonly [FolderPath, readonly string[]]) => !qualifyingFolders.has(folderPath))
        .flatMap(([, children]: readonly [FolderPath, readonly string[]]) => children);

    return {
        folders,
        nodeToFolder,
        rootNodeIds: [...rootNodes, ...nonQualifyingRoots],
    };
}
