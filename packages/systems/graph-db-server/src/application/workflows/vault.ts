import { initGraphModel } from '@vt/graph-model'
import {
  AddReadPathRequestSchema,
  SetWritePathRequestSchema,
  type VaultState,
} from '@vt/graph-db-server/contract'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { validateAbsolutePath } from '../util/validatePath.ts'
import {
  classifyAddReadPathResult,
  classifyRemoveReadPathResult,
  classifySetWritePathResult,
  composeReadPathsResponse,
  composeVaultState,
  composeWritePathResponse,
  decodeVaultPath,
  resolveAppSupportPath,
} from '../core/handleVault.ts'
import {
  addReadPath,
  getReadPaths,
  getWritePath,
  removeReadPath,
  setWritePath,
} from '@vt/graph-db-server/state/vaultAllowlist'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

export function ensureVaultWorkflowInitialized(): void {
  initGraphModel({ appSupportPath: resolveAppSupportPath() })
}

function getMountedVaultRoot(): string {
  const vaultPath = getProjectRootWatchedDirectory()
  if (!vaultPath) {
    throw new Error('Mounted vault root is not initialized')
  }
  return vaultPath
}

async function readVaultState(): Promise<VaultState> {
  const vaultPath = getMountedVaultRoot()
  const readPaths = [...(await getReadPaths())]
  const writePathOption = await getWritePath()
  return composeVaultState({ vaultPath, readPaths, writePathOption })
}

export async function readVaultWorkflow(): Promise<HttpResult> {
  try {
    return jsonResult(await readVaultState())
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

  const result = await addReadPath(validatedPath.path)
  const classification = classifyAddReadPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  return jsonResult(composeReadPathsResponse(await getReadPaths()))
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

  const result = await removeReadPath(validatedPath.path)
  const classification = classifyRemoveReadPathResult(result)
  if (classification.kind === 'error') {
    return errorResult(
      classification.message,
      classification.code,
      classification.status,
    )
  }

  return jsonResult(composeReadPathsResponse(await getReadPaths()))
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

  const result = await setWritePath(validatedPath.path)
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
