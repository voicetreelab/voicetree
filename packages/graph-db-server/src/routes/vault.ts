import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  addReadPath,
  getProjectRootWatchedDirectory,
  getReadPaths,
  getWritePath,
  initGraphModel,
  removeReadPath,
  setWritePath,
} from '@vt/graph-model'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  AddReadPathRequestSchema,
  type AddReadPathRequest,
  SetWritePathRequestSchema,
  type SetWritePathRequest,
  VaultStateSchema,
  type VaultState,
} from '../contract.ts'
import { validateAbsolutePath } from '../util/validatePath.ts'

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
})

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

function ensureGraphModelInitialized(): void {
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

function jsonError(
  c: {
    json: (body: unknown, status?: number) => Response
  },
  error: string,
  code: string,
  status = 400,
): Response {
  return c.json(ErrorResponseSchema.parse({ error, code }), status)
}

export function mountVaultRoutes(app: Hono): void {
  ensureGraphModelInitialized()

  // Same-backend-fn invariant: keep these daemon routes on the same
  // @vt/graph-model exports the IPC surface exposes via
  // webapp/src/shell/edge/main/api.ts:120-122.
  app.get('/vault', async (c) => {
    try {
      return c.json(await readVaultState())
    } catch (error) {
      return jsonError(
        c,
        (error as Error).message,
        'VAULT_STATE_READ_FAILED',
        500,
      )
    }
  })

  app.post('/vault/read-paths', async (c) => {
    let body: AddReadPathRequest
    try {
      body = AddReadPathRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }

    const validatedPath = await validateAbsolutePath(body.path, {
      requireExists: true,
    })
    if (!validatedPath.ok) {
      return jsonError(c, validatedPath.error, validatedPath.code)
    }

    // v1 preserves the existing external-read-path behaviour. We validate
    // shape/existence here but defer any mounted-root restriction.
    const result = await addReadPath(validatedPath.path)
    if (!result.success) {
      if (result.error === 'Path already in readPaths') {
        return c.json(
          ReadPathsResponseSchema.parse({
            readPaths: [...(await getReadPaths())],
          }),
        )
      }
      return jsonError(
        c,
        result.error ?? 'Failed to add read path',
        'ADD_READ_PATH_FAILED',
        500,
      )
    }

    return c.json(
      ReadPathsResponseSchema.parse({
        readPaths: [...(await getReadPaths())],
      }),
    )
  })

  app.delete('/vault/read-paths/:encodedPath', async (c) => {
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(c.req.param('encodedPath'))
    } catch {
      return jsonError(c, 'Invalid encoded path', 'INVALID_PATH_ENCODING')
    }

    const validatedPath = await validateAbsolutePath(decodedPath)
    if (!validatedPath.ok) {
      return jsonError(c, validatedPath.error, validatedPath.code)
    }

    const result = await removeReadPath(validatedPath.path)
    if (!result.success) {
      if (result.error === 'Cannot remove write path') {
        return jsonError(c, result.error, 'CANNOT_REMOVE_WRITE_PATH')
      }
      return jsonError(
        c,
        result.error ?? 'Failed to remove read path',
        'REMOVE_READ_PATH_FAILED',
        500,
      )
    }

    return c.json(
      ReadPathsResponseSchema.parse({
        readPaths: [...(await getReadPaths())],
      }),
    )
  })

  app.put('/vault/write-path', async (c) => {
    let body: SetWritePathRequest
    try {
      body = SetWritePathRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }

    const validatedPath = await validateAbsolutePath(body.path, {
      requireExists: true,
    })
    if (!validatedPath.ok) {
      return jsonError(c, validatedPath.error, validatedPath.code)
    }

    const result = await setWritePath(validatedPath.path)
    if (!result.success) {
      return jsonError(
        c,
        result.error ?? 'Failed to set write path',
        'SET_WRITE_PATH_FAILED',
        500,
      )
    }

    return c.json(
      WritePathResponseSchema.parse({
        writePath: validatedPath.path,
      }),
    )
  })
}
