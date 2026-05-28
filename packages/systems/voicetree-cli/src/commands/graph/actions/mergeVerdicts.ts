import type {
    FilesystemAuthoringFix,
    FilesystemAuthoringPlanEntry,
    FilesystemAuthoringValidationError,
} from '@vt/graph-tools/node'
import type {AppliedNode} from '../io/filesystem'
import type {GatedInput} from './gateVerdicts'
import type {
    GraphCreateResult,
    GraphCreateSuccess,
    NodeVerdict,
} from '../core/types'

export function indexMcpResults(result: GraphCreateSuccess): ReadonlyMap<string, GraphCreateResult> {
    const indexed: Map<string, GraphCreateResult> = new Map()
    for (const node of result.nodes) {
        indexed.set(node.path, node)
    }
    return indexed
}

export function mergeMcpResults(
    gateVerdicts: readonly GatedInput[],
    mcpResultsByAbsolutePath: ReadonlyMap<string, GraphCreateResult>,
    overrideRuleIdsByPath: ReadonlyMap<string, readonly string[]>,
): readonly NodeVerdict[] {
    return gateVerdicts.map((gated): NodeVerdict => {
        const mcpResult: GraphCreateResult | undefined =
            gated.absoluteTargetForMerge !== undefined
                ? mcpResultsByAbsolutePath.get(gated.absoluteTargetForMerge)
                : undefined
        const overridden: readonly string[] | undefined = overrideRuleIdsByPath.get(gated.path)
        const overriddenField: Partial<NodeVerdict> =
            overridden && overridden.length > 0 ? {overriddenRuleIds: overridden} : {}

        if (gated.verdict.status === 'skipped') return gated.verdict

        if (mcpResult !== undefined && mcpResult.status === 'warning') {
            return {
                path: gated.path,
                status: 'warning',
                ...(mcpResult.warning ? {warning: mcpResult.warning} : {}),
                ...overriddenField,
            }
        }

        return {
            path: gated.path,
            status: 'ok',
            ...(gated.verdict.typeName ? {typeName: gated.verdict.typeName} : {}),
            ...(gated.verdict.schemaPath ? {schemaPath: gated.verdict.schemaPath} : {}),
            ...overriddenField,
        }
    })
}

export function indexPlanErrorsByFilename(
    errors: readonly FilesystemAuthoringValidationError[],
): {
    readonly byFilename: ReadonlyMap<string, readonly FilesystemAuthoringValidationError[]>
    readonly unattached: readonly FilesystemAuthoringValidationError[]
} {
    const byFilename: Map<string, FilesystemAuthoringValidationError[]> = new Map()
    const unattached: FilesystemAuthoringValidationError[] = []
    for (const err of errors) {
        if (err.filename === undefined) {
            unattached.push(err)
            continue
        }
        const existing: FilesystemAuthoringValidationError[] = byFilename.get(err.filename) ?? []
        existing.push(err)
        byFilename.set(err.filename, existing)
    }
    return {byFilename, unattached}
}

export function mergePlanIntoGateVerdicts(
    gateVerdicts: readonly GatedInput[],
    writePlan: readonly FilesystemAuthoringPlanEntry[],
    planErrorsByFilename: ReadonlyMap<string, readonly FilesystemAuthoringValidationError[]>,
): readonly NodeVerdict[] {
    const planByFilename: Map<string, FilesystemAuthoringPlanEntry> = new Map()
    for (const entry of writePlan) {
        planByFilename.set(entry.filename, entry)
    }

    return gateVerdicts.map((gated): NodeVerdict => {
        if (gated.verdict.status !== 'ok') return gated.verdict

        const planErrors: readonly FilesystemAuthoringValidationError[] | undefined =
            planErrorsByFilename.get(gated.path)
        if (planErrors !== undefined && planErrors.length > 0) {
            return {
                path: gated.path,
                status: 'rejected',
                planErrorMessage: planErrors.map((e) => e.message).join('; '),
            }
        }

        const planEntry: FilesystemAuthoringPlanEntry | undefined = planByFilename.get(gated.path)
        return {
            ...gated.verdict,
            ...(planEntry && planEntry.fixes.length > 0 ? {fixes: planEntry.fixes} : {}),
        }
    })
}

export function mergeAppliedNodes(
    verdicts: readonly NodeVerdict[],
    applied: readonly AppliedNode[],
): readonly NodeVerdict[] {
    const fixesByPath: Map<string, readonly FilesystemAuthoringFix[]> = new Map()
    for (const entry of applied) {
        fixesByPath.set(entry.path, entry.fixes)
    }

    return verdicts.map((verdict): NodeVerdict => {
        if (verdict.status !== 'ok') return verdict
        const fixes: readonly FilesystemAuthoringFix[] | undefined = fixesByPath.get(verdict.path)
        if (fixes && fixes.length > 0) {
            return {...verdict, fixes}
        }
        return verdict
    })
}
