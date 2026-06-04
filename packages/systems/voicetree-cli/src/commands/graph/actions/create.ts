import {
    buildFilesystemAuthoringPlan,
    type FilesystemAuthoringInput,
} from '@vt/graph-tools/node-runtime'
import {callDaemon, error} from '../cliDeps'
import {
    getErrorMessage,
    parseGraphCreateArgs,
    parseInlineNode,
    requireTerminalId,
} from '../core/args'
import {buildBatchReport} from '../core/schemaGate'
import {
    applyFilesystemPlan,
    loadFilesystemInputs,
    loadNodesFromFile,
    validateExternalParent,
    type AppliedNode,
} from '../io/filesystem'
import {readCreateGraphPayloadFromStdin} from '../io/stdin'
import {mergeOverrideSpecs} from '../core/overrideSpec'
import type {
    GraphCreateNode,
    GraphCreateSuccess,
    NodeVerdict,
    OverrideSpec,
    ParsedGraphCreateArgs,
    ToolFailure,
} from '../core/types'
import {
    anyGateRejected,
    collectFilesystemGateVerdicts,
    collectLiveGateVerdicts,
    type GatedInput,
} from './gateVerdicts'
import {emitBatchReport, emitMcpFailureAndExit} from './batchEmit'
import {
    filesystemViolationsToPlanErrors,
    findNodeMustHaveEdgeViolations,
    resolveFilesystemOverrides,
    violationFilenamesByRuleId,
    type FilesystemRuleViolation,
} from './orphanCheck'
import {
    indexAuthoredResultsByPath,
    indexPlanErrorsByFilename,
    mergeAppliedNodes,
    mergeAuthoredResultsIntoVerdicts,
    mergePlanIntoGateVerdicts,
} from './mergeVerdicts'

function overrideRuleIdMap(
    gateVerdicts: readonly GatedInput[],
    overrides: readonly OverrideSpec[],
): ReadonlyMap<string, readonly string[]> {
    const ruleIds: readonly string[] = overrides.map((o) => o.ruleId)
    return new Map(gateVerdicts.map((g) => [g.path, ruleIds]))
}

async function runLiveDaemon(
    payload: Record<string, unknown>,
    gateVerdicts: readonly GatedInput[],
    overrides: readonly OverrideSpec[],
): Promise<void> {
    try {
        const response: unknown = await callDaemon('create_graph', payload)
        const result: GraphCreateSuccess | ToolFailure = response as GraphCreateSuccess | ToolFailure
        if (!result.success) {
            emitMcpFailureAndExit(result.error)
        }

        const merged: readonly NodeVerdict[] = mergeAuthoredResultsIntoVerdicts(
            gateVerdicts,
            indexAuthoredResultsByPath(result),
            result.nodes,
            overrideRuleIdMap(gateVerdicts, overrides),
        )
        emitBatchReport(buildBatchReport(merged))
    } catch (toolError: unknown) {
        error(`create_graph failed: ${getErrorMessage(toolError)}`)
    }
}

async function runStdinLive(
    terminalId: string | undefined,
    parsedArgs: Extract<ParsedGraphCreateArgs, {mode: 'live'}>,
): Promise<void> {
    const {callerTerminalId, parentNodeId, nodes, overrides: stdinOverrides} =
        await readCreateGraphPayloadFromStdin(terminalId)
    const overrides: readonly OverrideSpec[] = mergeOverrideSpecs(stdinOverrides, parsedArgs.overrides)
    const effectiveParentNodeId: string | undefined = parentNodeId ?? parsedArgs.parentNodeId

    const gateVerdicts: readonly GatedInput[] = await collectLiveGateVerdicts(
        nodes,
        effectiveParentNodeId,
        parsedArgs.color,
    )

    if (anyGateRejected(gateVerdicts)) {
        emitBatchReport(buildBatchReport(gateVerdicts.map((g) => g.verdict)))
        return
    }

    const daemonPayload: Record<string, unknown> = {
        callerTerminalId,
        ...(effectiveParentNodeId !== undefined ? {parentNodeId: effectiveParentNodeId} : {}),
        nodes,
        ...(overrides.length > 0 ? {override_with_rationale: overrides} : {}),
    }
    await runLiveDaemon(daemonPayload, gateVerdicts, overrides)
}

async function runFilesystem(
    parsedArgs: Extract<ParsedGraphCreateArgs, {mode: 'filesystem'}>,
): Promise<void> {
    const filesystemInputs: FilesystemAuthoringInput[] = loadFilesystemInputs(parsedArgs.inputFilePaths)
    const gateVerdicts: readonly GatedInput[] = await collectFilesystemGateVerdicts(filesystemInputs)

    if (anyGateRejected(gateVerdicts)) {
        emitBatchReport(buildBatchReport(gateVerdicts.map((g) => g.verdict)))
        return
    }

    const externalParentRef: string | undefined = parsedArgs.parentPath
        ? validateExternalParent(parsedArgs.parentPath, parsedArgs.inputFilePaths)
        : undefined
    const planResult: ReturnType<typeof buildFilesystemAuthoringPlan> = buildFilesystemAuthoringPlan({
        inputs: filesystemInputs,
        ...(parsedArgs.manifest ? {manifest: parsedArgs.manifest} : {}),
        agentName: process.env.AGENT_NAME,
        defaultColor: parsedArgs.color ?? 'blue',
    })

    if (planResult.status !== 'ok') {
        const {byFilename, unattached} = indexPlanErrorsByFilename(planResult.errors)
        const merged: readonly NodeVerdict[] = mergePlanIntoGateVerdicts(gateVerdicts, [], byFilename)
        emitBatchReport(buildBatchReport(merged, unattached))
        return
    }

    const attachmentViolations: readonly FilesystemRuleViolation[] = findNodeMustHaveEdgeViolations(
        planResult.writePlan,
        externalParentRef,
    )
    const attachmentOverrides = resolveFilesystemOverrides(attachmentViolations, parsedArgs.overrides)
    if (attachmentOverrides.unresolved.length > 0) {
        const {byFilename} = indexPlanErrorsByFilename(
            filesystemViolationsToPlanErrors(attachmentOverrides.unresolved),
        )
        const merged: readonly NodeVerdict[] = mergePlanIntoGateVerdicts(
            gateVerdicts,
            planResult.writePlan,
            byFilename,
        )
        emitBatchReport(buildBatchReport(merged))
        return
    }

    const verdictsAfterPlan: readonly NodeVerdict[] = mergePlanIntoGateVerdicts(
        gateVerdicts,
        planResult.writePlan,
        new Map(),
        violationFilenamesByRuleId(attachmentViolations, 'node_must_have_edge'),
    )

    if (parsedArgs.validateOnly) {
        emitBatchReport(buildBatchReport(verdictsAfterPlan))
        return
    }

    let applied: readonly AppliedNode[]
    try {
        applied = applyFilesystemPlan(planResult.writePlan, externalParentRef)
    } catch (writeError: unknown) {
        error(getErrorMessage(writeError))
    }

    emitBatchReport(buildBatchReport(mergeAppliedNodes(verdictsAfterPlan, applied)))
}

async function runFlagLive(
    terminalId: string | undefined,
    parsedArgs: Extract<ParsedGraphCreateArgs, {mode: 'live'}>,
): Promise<void> {
    const callerTerminalId: string = requireTerminalId(terminalId)

    if (parsedArgs.nodesFile && parsedArgs.inlineNodeSpecs.length > 0) {
        error('Use either --nodes-file or --node, not both')
    }

    if (!parsedArgs.nodesFile && parsedArgs.inlineNodeSpecs.length === 0) {
        error('graph create requires filesystem markdown inputs, --nodes-file FILE, or at least one --node value')
    }

    const nodes: GraphCreateNode[] = parsedArgs.nodesFile
        ? loadNodesFromFile(parsedArgs.nodesFile, parsedArgs.color)
        : parsedArgs.inlineNodeSpecs.map((spec: string) => parseInlineNode(spec, parsedArgs.color))

    if (nodes.length === 0) {
        error('graph create requires at least one node')
    }

    const gateVerdicts: readonly GatedInput[] = await collectLiveGateVerdicts(
        nodes,
        parsedArgs.parentNodeId,
        parsedArgs.color,
    )

    if (anyGateRejected(gateVerdicts)) {
        emitBatchReport(buildBatchReport(gateVerdicts.map((g) => g.verdict)))
        return
    }

    const daemonPayload: Record<string, unknown> = {
        callerTerminalId,
        ...(parsedArgs.parentNodeId ? {parentNodeId: parsedArgs.parentNodeId} : {}),
        nodes,
        ...(parsedArgs.overrides.length > 0 ? {override_with_rationale: parsedArgs.overrides} : {}),
    }
    await runLiveDaemon(daemonPayload, gateVerdicts, parsedArgs.overrides)
}

export async function graphCreate(terminalId: string | undefined, args: string[]): Promise<void> {
    const parsedArgs: ParsedGraphCreateArgs = parseGraphCreateArgs(args)

    if (parsedArgs.mode === 'live' && parsedArgs.validateOnly) {
        error('The --validate-only flag is only supported for filesystem markdown inputs')
    }

    if (
        parsedArgs.mode === 'live' &&
        !process.stdin.isTTY &&
        !parsedArgs.nodesFile &&
        parsedArgs.inlineNodeSpecs.length === 0
    ) {
        await runStdinLive(terminalId, parsedArgs)
        return
    }

    if (parsedArgs.mode === 'filesystem') {
        await runFilesystem(parsedArgs)
        return
    }

    await runFlagLive(terminalId, parsedArgs)
}
