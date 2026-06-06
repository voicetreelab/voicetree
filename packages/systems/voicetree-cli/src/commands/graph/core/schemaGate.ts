import type {FilesystemAuthoringValidationError} from '@vt/graph-tools/node-runtime'
import {resolveTypeForTarget, type ResolvedFolderType} from './folderNoteType'
import {loadSchemaPlugin} from './loadSchemaPlugin'
import type {
    BatchReport,
    BatchReportSummary,
    NodeVerdict,
    SchemaViolation,
    SkipReason,
    ValidationError,
    Validator,
    ValidatorMap,
} from './types'

export type SchemaGateInput = {
    readonly targetPath: string
    readonly rawBody: string
    readonly projectRoot: string
}

export type SchemaGateResult =
    | {readonly status: 'skipped'; readonly reason: SkipReason}
    | {readonly status: 'ok'; readonly typeName?: string; readonly schemaPath?: string}
    | {readonly status: 'rejected'; readonly violation: SchemaViolation}

export async function runSchemaGate(input: SchemaGateInput): Promise<SchemaGateResult> {
    const resolved: ResolvedFolderType | undefined = resolveTypeForTarget(input.targetPath, input.projectRoot)
    // No upstream `## Type` folder note → the gate has nothing to validate
    // against. Emit a silent `ok`: the file is still written, and the report
    // shouldn't surface a misleading "skipped" status for the common case of a
    // typeless folder. Misconfigurations (`no_schema_plugin`, `unknown_type`)
    // remain loud skips so the user hears about them.
    if (!resolved) return {status: 'ok'}

    const plugin: ValidatorMap | undefined = await loadSchemaPlugin(input.projectRoot)
    if (!plugin) return {status: 'skipped', reason: 'no_schema_plugin'}

    const validator: Validator | undefined = plugin[resolved.typeName]
    if (!validator) return {status: 'skipped', reason: 'unknown_type'}

    const violations: readonly ValidationError[] = validator.validate(input.rawBody)
    if (violations.length === 0) {
        return {status: 'ok', typeName: resolved.typeName, schemaPath: resolved.noteFilePath}
    }

    return {
        status: 'rejected',
        violation: {
            kind: 'schema_violation',
            targetPath: input.targetPath,
            typeName: resolved.typeName,
            schemaPath: resolved.noteFilePath,
            violations,
        },
    }
}

const SKIP_MESSAGES: Readonly<Record<SkipReason, string>> = {
    no_schema_plugin: 'no .voicetree/schemas.cjs in project',
    unknown_type: 'declared Type is not registered in schemas.cjs',
    no_project_detected: 'no project detected from working directory',
    no_parent_for_live_node: 'no parent node id supplied for live-mode node',
}

export function describeSkipReason(reason: SkipReason): string {
    return SKIP_MESSAGES[reason]
}

export function summarizeVerdicts(verdicts: readonly NodeVerdict[]): BatchReportSummary {
    const summary = {ok: 0, rejected: 0, skipped: 0, warning: 0}
    for (const verdict of verdicts) {
        summary[verdict.status] += 1
    }
    return summary
}

export function buildBatchReport(
    verdicts: readonly NodeVerdict[],
    planErrors?: readonly FilesystemAuthoringValidationError[] | undefined
): BatchReport {
    return {
        kind: 'graph_create_batch_result',
        nodes: verdicts,
        summary: summarizeVerdicts(verdicts),
        ...(planErrors && planErrors.length > 0 ? {planErrors} : {}),
    }
}

export function reportExitCode(report: BatchReport): 0 | 1 {
    return report.summary.rejected > 0 ? 1 : 0
}

function formatOverrideHint(ruleIds: readonly string[]): string {
    return ruleIds.map((id: string): string => `--override '${id}:<rationale>'`).join(' ')
}

function formatRuleIdList(ruleIds: readonly string[]): string {
    return ruleIds.map((id: string): string => `[${id}]`).join(' ')
}

export function formatBatchReportLine(verdict: NodeVerdict): string {
    switch (verdict.status) {
        case 'ok': {
            const overridden: string =
                verdict.overriddenRuleIds && verdict.overriddenRuleIds.length > 0
                    ? `  (overridden: ${verdict.overriddenRuleIds.join(', ')})`
                    : ''
            const fixes: string =
                verdict.fixes && verdict.fixes.length > 0
                    ? `  (fixed: ${verdict.fixes.map((fix) => fix.message).join('; ')})`
                    : ''
            return `✓ ${verdict.path}${overridden}${fixes}`
        }
        case 'rejected': {
            const ruleIds: readonly string[] = verdict.ruleIds ?? []
            const ruleIdsLabel: string = ruleIds.length > 0 ? `  ${formatRuleIdList(ruleIds)}` : ''
            const planMessage: string = verdict.planErrorMessage ? `  ${verdict.planErrorMessage}` : ''
            const overrideHint: string =
                ruleIds.length > 0
                    ? `  (rerun with ${formatOverrideHint(ruleIds)})`
                    : ''
            return `✗ ${verdict.path}${ruleIdsLabel}${planMessage}${overrideHint}`
        }
        case 'skipped': {
            const reasonText: string =
                verdict.skipReason !== undefined ? describeSkipReason(verdict.skipReason) : 'gate did not fire'
            return `⊘ ${verdict.path}  (skipped: ${reasonText})`
        }
        case 'warning': {
            const warningText: string = verdict.warning ?? 'unspecified warning'
            return `~ ${verdict.path}  (warning: ${warningText})`
        }
    }
}

export function formatBatchReportSummary(summary: BatchReportSummary, exitCode: 0 | 1): string {
    return `Summary: ${summary.ok} ok, ${summary.rejected} rejected, ${summary.skipped} skipped, ${summary.warning} warning. Exit ${exitCode}.`
}

export function formatBatchReportJson(report: BatchReport): string {
    return JSON.stringify(report, null, 2)
}
