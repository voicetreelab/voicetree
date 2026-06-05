import type {FilesystemAuthoringPlanEntry} from '@vt/graph-tools/node-runtime'
import type {OverridableRuleId, OverrideEntry} from '@vt/graph-validation'
import {normalizeRef} from '../core/util'

export type FilesystemRuleViolation = {
    readonly ruleId: OverridableRuleId
    readonly message: string
    readonly nodeFilename: string
    readonly details: Readonly<Record<string, unknown>>
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
export function findNodeMustHaveEdgeViolations(
    writePlan: readonly FilesystemAuthoringPlanEntry[],
    externalParentRef: string | undefined,
): readonly FilesystemRuleViolation[] {
    return writePlan
        .filter((entry) => !entryWillHaveParent(entry, externalParentRef))
        .map((entry) => ({
            ruleId: 'node_must_have_edge',
            message:
                `Node "${entry.filename}" has no parent edge; it would be created ` +
                `disconnected from the graph. Add a "- parent [[<existing-node>]]" line ` +
                `to its body, anchor it under a --manifest tree whose root links to an ` +
                `existing node, or pass --parent <existing-node>.`,
            nodeFilename: entry.filename,
            details: {filename: entry.filename},
        }))
}

export function resolveFilesystemOverrides(
    violations: readonly FilesystemRuleViolation[],
    overrides: readonly OverrideEntry[],
): {
    readonly unresolved: readonly FilesystemRuleViolation[]
    readonly accepted: readonly OverrideEntry[]
} {
    const overridesByRuleId: ReadonlyMap<OverridableRuleId, OverrideEntry> = new Map(
        overrides.map((entry) => [entry.ruleId, entry]),
    )
    const unresolved: FilesystemRuleViolation[] = []
    const acceptedByRuleId: Map<OverridableRuleId, OverrideEntry> = new Map()

    for (const violation of violations) {
        const override: OverrideEntry | undefined = overridesByRuleId.get(violation.ruleId)
        if (override === undefined) {
            unresolved.push(violation)
            continue
        }
        acceptedByRuleId.set(violation.ruleId, override)
    }

    return {unresolved, accepted: [...acceptedByRuleId.values()]}
}

export function violationFilenamesByRuleId(
    violations: readonly FilesystemRuleViolation[],
    ruleId: OverridableRuleId,
): ReadonlyMap<string, readonly OverridableRuleId[]> {
    const byFilename: Map<string, OverridableRuleId[]> = new Map()
    for (const violation of violations) {
        if (violation.ruleId !== ruleId) continue
        const existing: OverridableRuleId[] = byFilename.get(violation.nodeFilename) ?? []
        existing.push(violation.ruleId)
        byFilename.set(violation.nodeFilename, existing)
    }
    return byFilename
}

export function filesystemViolationsToPlanErrors(
    violations: readonly FilesystemRuleViolation[],
): readonly {readonly message: string; readonly filename: string; readonly ruleId: OverridableRuleId}[] {
    const planErrors: {message: string; filename: string; ruleId: OverridableRuleId}[] = []
    for (const violation of violations) {
        planErrors.push({
            message: violation.message,
            filename: violation.nodeFilename,
            ruleId: violation.ruleId,
        })
    }
    return planErrors
}

function entryWillHaveParent(
    entry: FilesystemAuthoringPlanEntry,
    externalParentRef: string | undefined,
): boolean {
    const hasParentLine: boolean = hasCanonicalParentLine(entry.markdown)
    const willAttachExternal: boolean =
        externalParentRef !== undefined &&
        entry.parentFilenames.length === 0 &&
        normalizeRef(entry.filename) !== externalParentRef
    return hasParentLine || willAttachExternal
}

function hasCanonicalParentLine(markdown: string): boolean {
    return /^- parent \[\[[^[\]\n\r]+\]\]$/m.test(markdown)
}
