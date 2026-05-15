import { homedir } from 'node:os'
import { join } from 'node:path'
import { initGraphModel } from '@vt/graph-model'
import { z } from 'zod'
import {
  AddReadPathRequestSchema,
  SetWritePathRequestSchema,
  VaultStateSchema,
  type VaultState,
} from '@vt/graph-db-server/contract'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { validateAbsolutePath } from '../util/validatePath.ts'
import {
  addReadPath,
  getReadPaths,
  getWritePath,
  removeReadPath,
  setWritePath,
} from '@vt/graph-db-server/state/vaultAllowlist'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

const ReadPathsResponseSchema = z.object({
  readPaths: z.array(z.string()),
})

const WritePathResponseSchema = z.object({
  writePath: z.string(),
})

function resolveAppSupportPath(): string {
  const fromEnv = process.env.VOICETREE_APP_SUPPORT?.trim()
  if (fromEnv) return fromEnv

  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Voicetree')
  }
  if (process.platform === 'win32') {
    return join(
      process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
      'Voicetree',
    )
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(home, '.config'),
    'Voicetree',
  )
}

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
  const writePath =
    typeof (writePathOption as { value?: unknown }).value === 'string'
      ? (writePathOption as { value: string }).value
      : vaultPath

  return VaultStateSchema.parse({ vaultPath, readPaths, writePath })
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
  if (!result.success) {
    if (
      result.error === 'Path already in readPaths' ||
      result.error === 'Path already expanded'
    ) {
      return jsonResult(ReadPathsResponseSchema.parse({
        readPaths: [...(await getReadPaths())],
      }))
    }
    return errorResult(
      result.error ?? 'Failed to add read path',
      'ADD_READ_PATH_FAILED',
      500,
    )
  }

  return jsonResult(ReadPathsResponseSchema.parse({
    readPaths: [...(await getReadPaths())],
  }))
}

export async function removeReadPathWorkflow(
  encodedPath: string,
): Promise<HttpResult> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    return errorResult('Invalid encoded path', 'INVALID_PATH_ENCODING')
  }

  const validatedPath = await validateAbsolutePath(decodedPath)
  if (!validatedPath.ok) {
    return errorResult(validatedPath.error, validatedPath.code)
  }

  const result = await removeReadPath(validatedPath.path)
  if (!result.success) {
    if (result.error === 'Cannot remove write path') {
      return errorResult(result.error, 'CANNOT_REMOVE_WRITE_PATH')
    }
    return errorResult(
      result.error ?? 'Failed to remove read path',
      'REMOVE_READ_PATH_FAILED',
      500,
    )
  }

  return jsonResult(ReadPathsResponseSchema.parse({
    readPaths: [...(await getReadPaths())],
  }))
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
  if (!result.success) {
    return errorResult(
      result.error ?? 'Failed to set write path',
      'SET_WRITE_PATH_FAILED',
      500,
    )
  }

  return jsonResult(WritePathResponseSchema.parse({
    writePath: validatedPath.path,
  }))
}
