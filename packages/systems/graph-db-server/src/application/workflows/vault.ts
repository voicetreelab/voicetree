import {
  AddReadPathRequestSchema,
  SetWritePathRequestSchema,
} from '@vt/graph-db-server/contract'
import { validateAbsolutePath } from '../util/validatePath.ts'
import {
  classifyAddReadPathResult,
  classifyRemoveReadPathResult,
  classifySetWritePathResult,
  composeReadPathsResponse,
  composeWritePathResponse,
  decodeVaultPath,
  resolveAppSupportPath,
} from '../core/handleVault.ts'
import { runCommand } from '../effects/runCommand.ts'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

export function ensureVaultWorkflowInitialized(): void {
  void runCommand({
    type: 'InitializeGraphModel',
    appSupportPath: resolveAppSupportPath(),
  })
}

export async function readVaultWorkflow(): Promise<HttpResult> {
  try {
    return jsonResult(await runCommand({ type: 'ReadVaultState' }))
  } catch (error) {
    return errorResult(
      (error as Error).message,
      'VAULT_STATE_READ_FAILED',
      500,
    )
  }
}

export async function addReadPathWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = AddReadPathRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const validatedPath = await validateAbsolutePath(body.data.path, {
    requireExists: true,
  })
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await runCommand({
    type: 'AddVaultReadPath',
    path: validatedPath.path,
  })
  const classification = classifyAddReadPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  const vaultState = await runCommand({ type: 'ReadVaultState' })
  return jsonResult(composeReadPathsResponse(vaultState.readPaths))
}

export async function removeReadPathWorkflow(
  encodedPath: string,
): Promise<HttpResult> {
  const decodedPath = decodeVaultPath(encodedPath)
  if (!decodedPath.ok) {
    return errorResult(decodedPath.error, decodedPath.code)
  }

  const validatedPath = await validateAbsolutePath(decodedPath.decoded)
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await runCommand({
    type: 'RemoveVaultReadPath',
    path: validatedPath.path,
  })
  const classification = classifyRemoveReadPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  const vaultState = await runCommand({ type: 'ReadVaultState' })
  return jsonResult(composeReadPathsResponse(vaultState.readPaths))
}

export async function setWritePathWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = SetWritePathRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const validatedPath = await validateAbsolutePath(body.data.path, {
    requireExists: true,
  })
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await runCommand({
    type: 'SetVaultWritePath',
    path: validatedPath.path,
  })
  const classification = classifySetWritePathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  return jsonResult(composeWritePathResponse(validatedPath.path))
}
