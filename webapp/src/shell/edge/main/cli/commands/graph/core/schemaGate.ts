import {resolveTypeForTarget, type ResolvedFolderType} from './folderNoteType'
import {loadSchemaPlugin} from './loadSchemaPlugin'
import type {SchemaViolation, ValidationError, Validator, ValidatorMap} from './types'

export type SchemaGateInput = {
    readonly targetPath: string
    readonly rawBody: string
    readonly vaultRoot: string
}

export type SchemaGateResult =
    | {readonly status: 'skipped'}
    | {readonly status: 'ok'; readonly typeName: string; readonly schemaPath: string}
    | {readonly status: 'rejected'; readonly violation: SchemaViolation}

export async function runSchemaGate(input: SchemaGateInput): Promise<SchemaGateResult> {
    const resolved: ResolvedFolderType | undefined = resolveTypeForTarget(input.targetPath, input.vaultRoot)
    if (!resolved) return {status: 'skipped'}

    const plugin: ValidatorMap | undefined = await loadSchemaPlugin(input.vaultRoot)
    if (!plugin) return {status: 'skipped'}

    const validator: Validator | undefined = plugin[resolved.typeName]
    if (!validator) return {status: 'skipped'}

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

export function emitSchemaViolation(violation: SchemaViolation): void {
    process.stderr.write(`${JSON.stringify(violation, null, 2)}\n`)
}
