import {
    extractExistingParentRefs,
    type FilesystemAuthoringPlanEntry,
} from '@vt/graph-tools/node'
import {normalizeRef} from '../core/util'

export type OrphanNodeError = {
    readonly code: 'orphan_node'
    readonly message: string
    readonly filename: string
}

/**
 * Attachment policy for filesystem-mode `graph create`.
 *
 * The pure plan builder (`buildFilesystemAuthoringPlan`) is deliberately
 * agnostic about whether a node connects to the *existing* graph: a manifest
 * tree root legitimately has no in-batch parent, and whether that is an orphan
 * depends entirely on the external `--parent`, which only the CLI knows. So
 * the "every created node must have a parent edge" policy lives here, at the
 * orchestration edge, not in the library.
 *
 * A node is attached iff, after the plan is written, its file will contain at
 * least one `- parent [[...]]` line. That happens when:
 *   - it already carries a parent line (author-supplied body link or a
 *     manifest-derived parent, both are present in the assembled markdown), or
 *   - it will receive the external `--parent` appended by `applyFilesystemPlan`,
 *     which targets exactly the manifest-rootless nodes that are not the
 *     external parent itself.
 *
 * The `willAttachExternal` clause mirrors `applyFilesystemPlan`'s
 * `shouldAttachExternalParent` so this check stays consistent with what is
 * actually written to disk.
 */
export function findOrphanNodes(
    writePlan: readonly FilesystemAuthoringPlanEntry[],
    externalParentRef: string | undefined,
): readonly OrphanNodeError[] {
    return writePlan
        .filter((entry) => !entryWillHaveParent(entry, externalParentRef))
        .map((entry) => ({
            code: 'orphan_node',
            message:
                `Node "${entry.filename}" has no parent edge; it would be created ` +
                `disconnected from the graph. Add a "- parent [[<existing-node>]]" line ` +
                `to its body, anchor it under a --manifest tree whose root links to an ` +
                `existing node, or pass --parent <existing-node>.`,
            filename: entry.filename,
        }))
}

function entryWillHaveParent(
    entry: FilesystemAuthoringPlanEntry,
    externalParentRef: string | undefined,
): boolean {
    const hasParentLine: boolean = extractExistingParentRefs(entry.markdown).size > 0
    const willAttachExternal: boolean =
        externalParentRef !== undefined &&
        entry.parentFilenames.length === 0 &&
        normalizeRef(entry.filename) !== externalParentRef
    return hasParentLine || willAttachExternal
}
