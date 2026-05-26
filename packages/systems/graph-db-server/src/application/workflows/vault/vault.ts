import {
  AddReadPathRequestSchema,
  SetWriteFolderRequestSchema,
} from '@vt/graph-db-server/contract'
import { validateAbsolutePath } from '../../core/validatePath.ts'
import { VaultNotOpenError, structuredVaultErrorResult } from '../../errors/vaultNotOpen.ts'
import {
  classifyAddReadPathResult,
  classifyRemoveReadPathResult,
  classifySetWriteFolderResult,
  composeReadPathsResponse,
  composeWriteFolderResponse,
  decodeVaultPath,
  resolveAppSupportPath,
} from '../../core/handleVault.ts'
import { executeCommand } from '../dispatch.ts'
import { errorResult, jsonResult, type HttpResult } from '../httpResult.ts'
import { awaitVaultOpenReady } from './vaultOpenGate.ts'

// Upper bound for how long a vault-scoped read may wait on an in-flight
// `openVaultWorkflow` before falling through to the existing 409 path. Picked
// well above any expected open latency (folder scan + sync wiring is ~hundreds
// of ms in practice) while still leaving the renderer's overall RPC budget
// intact if the daemon genuinely stalls.
const VAULT_OPEN_READY_TIMEOUT_MS = 5000

export function ensureVaultWorkflowInitialized(): void {
  void executeCommand({
    type: 'InitializeGraphModel',
    appSupportPath: resolveAppSupportPath(),
  })
}

export async function readVaultWorkflow(): Promise<HttpResult> {
  try {
    await awaitVaultOpenReady(VAULT_OPEN_READY_TIMEOUT_MS)
    return jsonResult(await executeCommand({ type: 'ReadVaultState' }))
  } catch (error) {
    if (error instanceof VaultNotOpenError) {
      return structuredVaultErrorResult(error)
    }
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

  const result = await executeCommand({
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

  const vaultState = await executeCommand({ type: 'ReadVaultState' })
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

  const result = await executeCommand({
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

  const vaultState = await executeCommand({ type: 'ReadVaultState' })
  return jsonResult(composeReadPathsResponse(vaultState.readPaths))
}

export async function setWriteFolderWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = SetWriteFolderRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const validatedPath = await validateAbsolutePath(body.data.path, {
    requireExists: true,
  })
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await executeCommand({
    type: 'SetVaultWriteFolder',
    path: validatedPath.path,
  })
  const classification = classifySetWriteFolderResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  return jsonResult(composeWriteFolderResponse(validatedPath.path))
}
