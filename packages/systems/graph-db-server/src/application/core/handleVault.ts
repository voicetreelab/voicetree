import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  VaultStateSchema,
  type VaultState,
} from '@vt/graph-db-server/contract'

const ReadPathsResponseSchema = z.object({
  readPaths: z.array(z.string()),
})

const WritePathResponseSchema = z.object({
  writePath: z.string(),
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

export function resolveAppSupportPath(): string {
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
  readonly vaultPath: string
  readonly readPaths: readonly string[]
  readonly writePathOption: unknown
}): VaultState {
  const writePathOption = input.writePathOption as { readonly value?: unknown }
  const writePath = typeof writePathOption.value === 'string'
    ? writePathOption.value
    : input.vaultPath

  return VaultStateSchema.parse({
    vaultPath: input.vaultPath,
    readPaths: [...input.readPaths],
    writePath,
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

export function classifySetWritePathResult(
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

export function composeWritePathResponse(writePath: string): {
  readonly writePath: string
} {
  return WritePathResponseSchema.parse({ writePath })
}
