import { z } from 'zod'
import {
  VaultStateSchema,
  type VaultState,
} from '@vt/graph-db-server/contract'

const ReadPathsResponseSchema = z.object({
  readPaths: z.array(z.string()),
})

const WriteFolderResponseSchema = z.object({
  writeFolder: z.string(),
})

export type VaultMutationResult = {
  readonly success: boolean
  readonly error?: string
}

export type VaultMutationSuccess =
  | { readonly kind: 'success' }
  | { readonly kind: 'idempotent-success' }

export type VaultMutationError = {
  readonly kind: 'error'
  readonly message: string
  readonly code:
    | 'ADD_READ_PATH_FAILED'
    | 'CANNOT_REMOVE_WRITE_PATH'
    | 'REMOVE_READ_PATH_FAILED'
    | 'SET_WRITE_PATH_FAILED'
  readonly status: 400 | 500
}

export function decodeVaultPath(encodedPath: string):
  | { readonly ok: true; readonly decoded: string }
  | {
      readonly ok: false
      readonly error: string
      readonly code: 'INVALID_PATH_ENCODING'
    } {
  try {
    return { ok: true, decoded: decodeURIComponent(encodedPath) }
  } catch {
    return {
      ok: false,
      error: 'Invalid encoded path',
      code: 'INVALID_PATH_ENCODING',
    }
  }
}

export function composeVaultState(input: {
  readonly projectRoot: string
  readonly readPaths: readonly string[]
  readonly writeFolderOption: unknown
}): VaultState {
  const writeFolderOption = input.writeFolderOption as { readonly value?: unknown }
  const writeFolder = typeof writeFolderOption.value === 'string'
    ? writeFolderOption.value
    : input.projectRoot

  return VaultStateSchema.parse({
    projectRoot: input.projectRoot,
    readPaths: [...input.readPaths],
    writeFolder,
  })
}

export function classifyAddReadPathResult(
  result: VaultMutationResult,
): VaultMutationSuccess | VaultMutationError {
  if (result.success) return { kind: 'success' }
  if (
    result.error === 'Path already in readPaths' ||
    result.error === 'Path already expanded'
  ) {
    return { kind: 'idempotent-success' }
  }
  return {
    kind: 'error',
    message: result.error ?? 'Failed to add read path',
    code: 'ADD_READ_PATH_FAILED',
    status: 500,
  }
}

export function classifyRemoveReadPathResult(
  result: VaultMutationResult,
): { readonly kind: 'success' } | VaultMutationError {
  if (result.success) return { kind: 'success' }
  if (result.error === 'Cannot remove write path') {
    return {
      kind: 'error',
      message: result.error,
      code: 'CANNOT_REMOVE_WRITE_PATH',
      status: 400,
    }
  }
  return {
    kind: 'error',
    message: result.error ?? 'Failed to remove read path',
    code: 'REMOVE_READ_PATH_FAILED',
    status: 500,
  }
}

export function classifySetWriteFolderResult(
  result: VaultMutationResult,
): { readonly kind: 'success' } | VaultMutationError {
  if (result.success) return { kind: 'success' }
  return {
    kind: 'error',
    message: result.error ?? 'Failed to set write path',
    code: 'SET_WRITE_PATH_FAILED',
    status: 500,
  }
}

export function composeReadPathsResponse(readPaths: readonly string[]): {
  readonly readPaths: string[]
} {
  return ReadPathsResponseSchema.parse({ readPaths: [...readPaths] })
}

export function composeWriteFolderResponse(writeFolder: string): {
  readonly writeFolder: string
} {
  return WriteFolderResponseSchema.parse({ writeFolder })
}
