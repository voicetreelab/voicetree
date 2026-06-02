import type {
    FilesystemAuthoringFix,
    FilesystemAuthoringPlanEntry,
} from '@vt/graph-tools/node'
import {isAbsolute, relative as relativePath} from 'node:path'
import type {AppliedNode} from '../io/filesystem'
import type {GatedInput} from './gateVerdicts'
import type {
    GraphCreateResult,
    GraphCreateSuccess,
    NodeVerdict,
} from '../core/types'
import type {OverridableRuleId} from '@vt/graph-validation'

type PlanErrorLike = {
    readonly message: string
    readonly filename?: string
    readonly ruleId?: OverridableRuleId
}

export function indexAuthoredResultsByPath(result: GraphCreateSuccess): ReadonlyMap<string, GraphCreateResult> {
    const indexed: Map<string, GraphCreateResult> = new Map()
    for (const node of result.nodes) {
        indexed.set(node.path, node)
    }
    return indexed
}

export function mergeAuthoredResultsIntoVerdicts(
    gateVerdicts: readonly GatedInput[],
    createGraphResultsByAbsolutePath: ReadonlyMap<string, GraphCreateResult>,
    createGraphResultsByIndex: readonly GraphCreateResult[],
    overrideRuleIdsByPath: ReadonlyMap<string, readonly string[]>,
): readonly NodeVerdict[] {
    return gateVerdicts.map((gated, index): NodeVerdict => {
        const pathMatch: GraphCreateResult | undefined =
            gated.absoluteTargetForMerge !== undefined
                ? createGraphResultsByAbsolutePath.get(gated.absoluteTargetForMerge)
                : undefined
        const indexMatch: GraphCreateResult | undefined =
            createGraphResultsByIndex.length === gateVerdicts.length ? createGraphResultsByIndex[index] : undefined
        const createGraphResult: GraphCreateResult | undefined = pathMatch ?? indexMatch
        const overridden: readonly string[] | undefined = overrideRuleIdsByPath.get(gated.path)
        const overriddenField: Partial<NodeVerdict> =
            overridden && overridden.length > 0 ? {overriddenRuleIds: overridden} : {}
        const verdictPath: string = createGraphResult ? displayPathFromCreateGraphResult(createGraphResult.path) : gated.path

        if (gated.verdict.status === 'skipped' && createGraphResult === undefined) return gated.verdict

        if (createGraphResult !== undefined && createGraphResult.status === 'warning') {
            return {
                path: verdictPath,
                status: 'warning',
                ...(createGraphResult.warning ? {warning: createGraphResult.warning} : {}),
                ...overriddenField,
            }
        }

        return {
            path: verdictPath,
            status: 'ok',
            ...(gated.verdict.typeName ? {typeName: gated.verdict.typeName} : {}),
            ...(gated.verdict.schemaPath ? {schemaPath: gated.verdict.schemaPath} : {}),
            ...overriddenField,
        }
    })
}

function displayPathFromCreateGraphResult(resultPath: string): string {
    return isAbsolute(resultPath) ? relativePath(process.cwd(), resultPath) : resultPath
}

export function indexPlanErrorsByFilename<T extends PlanErrorLike>(
    errors: readonly T[],
): {
    readonly byFilename: ReadonlyMap<string, readonly T[]>
    readonly unattached: readonly T[]
} {
    const byFilename: Map<string, T[]> = new Map()
    const unattached: T[] = []
    for (const err of errors) {
        if (err.filename === undefined) {
            unattached.push(err)
            continue
        }
        const existing: T[] = byFilename.get(err.filename) ?? []
        existing.push(err)
        byFilename.set(err.filename, existing)
    }
    return {byFilename, unattached}
}

export function mergePlanIntoGateVerdicts(
    gateVerdicts: readonly GatedInput[],
    writePlan: readonly FilesystemAuthoringPlanEntry[],
    planErrorsByFilename: ReadonlyMap<string, readonly PlanErrorLike[]>,
    overriddenRuleIdsByFilename: ReadonlyMap<string, readonly OverridableRuleId[]> = new Map(),
): readonly NodeVerdict[] {
    const planByFilename: Map<string, FilesystemAuthoringPlanEntry> = new Map()
    for (const entry of writePlan) {
        planByFilename.set(entry.filename, entry)
    }

    return gateVerdicts.map((gated): NodeVerdict => {
        // Plan-level rejections must override any non-rejected gate verdict,
        // including `skipped` (schema didn't apply). A skipped verdict is not
        // an endorsement: an unresolved attachment rule violation whose folder
        // has no schema plugin must still be rejected, never silently dropped.
        const planErrors: readonly PlanErrorLike[] | undefined =
            planErrorsByFilename.get(gated.path)
        if (planErrors !== undefined && planErrors.length > 0) {
            const ruleIds: readonly OverridableRuleId[] = [
                ...new Set(planErrors.flatMap((e) => e.ruleId === undefined ? [] : [e.ruleId])),
            ]
            return {
                path: gated.path,
                status: 'rejected',
                planErrorMessage: planErrors.map((e) => e.message).join('; '),
                ...(ruleIds.length > 0 ? {ruleIds} : {}),
            }
        }

        if (gated.verdict.status !== 'ok') return gated.verdict

        const planEntry: FilesystemAuthoringPlanEntry | undefined = planByFilename.get(gated.path)
        const overriddenRuleIds: readonly OverridableRuleId[] | undefined =
            overriddenRuleIdsByFilename.get(gated.path)
        return {
            ...gated.verdict,
            ...(planEntry && planEntry.fixes.length > 0 ? {fixes: planEntry.fixes} : {}),
            ...(overriddenRuleIds && overriddenRuleIds.length > 0 ? {overriddenRuleIds} : {}),
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
