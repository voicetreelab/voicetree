import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { project } from '@vt/graph-state'
import {
  OpenVaultRequestSchema,
  OpenVaultResponseSchema,
  VaultStateSchema,
  type ActiveView,
  type FolderStateEntry,
  type OpenVaultRequest,
  type OpenVaultResponse,
  type VaultState,
} from '@vt/graph-db-server/contract'
import { getFolderStateForActiveView } from '@vt/graph-db-server/views/folderStateOps'
import { getVaultConfigForDirectory } from '@vt/app-config/vault-config'
import { createEmptyGraph } from '@vt/graph-model'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import {
  clearVaultPath,
  getReadPaths,
  getWritePath,
  resolveWritePath,
  setVaultPath,
  setWritePath,
} from '@vt/graph-db-server/state/vaultAllowlist'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import type { SessionRegistry } from '../session/registry.ts'
import {
  VaultNotOpenError,
  VaultOpenFailedError,
} from '../errors/vaultNotOpen.ts'

export type VaultResource = {
  openForVault(vaultPath: string): Promise<void>
  closeForVault(): Promise<void>
}

type LifecycleState = {
  activeSessionId: string | null
  activeVaultPath: string | null
  registry: SessionRegistry | null
}

const resources: VaultResource[] = []
const lifecycleState: LifecycleState = {
  activeSessionId: null,
  activeVaultPath: null,
  registry: null,
}

let mutexTail: Promise<unknown> = Promise.resolve()

export function configureVaultLifecycle(options: {
  activeVaultPath?: string | null
  registry: SessionRegistry
}): void {
  lifecycleState.activeVaultPath = options.activeVaultPath
    ? resolve(options.activeVaultPath)
    : null
  lifecycleState.activeSessionId = null
  lifecycleState.registry = options.registry
}

export function resetVaultLifecycle(): void {
  resources.length = 0
  lifecycleState.activeSessionId = null
  lifecycleState.activeVaultPath = null
  lifecycleState.registry = null
  mutexTail = Promise.resolve()
}

export async function withVaultMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexTail.then(fn, fn)
  mutexTail = run.catch(() => undefined)
  return await run
}

export function registerVaultResource(resource: VaultResource): void {
  resources.push(resource)
}

function getRegistry(): SessionRegistry {
  if (!lifecycleState.registry) {
    throw new VaultOpenFailedError('Vault lifecycle has not been initialized')
  }
  return lifecycleState.registry
}

function parseWritePath(writePathOption: Awaited<ReturnType<typeof getWritePath>>): string | null {
  const maybeValue = (writePathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? maybeValue : null
}

async function readVaultState(vaultPath: string): Promise<VaultState> {
  const readPaths = [...(await getReadPaths())]
  const writePath = parseWritePath(await getWritePath()) ?? vaultPath
  return VaultStateSchema.parse({ vaultPath, readPaths, writePath })
}

function readFolderVisibilitySnapshot(
  vaultPath: string,
): { folderState: FolderStateEntry[]; activeView: ActiveView } {
  try {
    return getFolderStateForActiveView(vaultPath) as {
      folderState: FolderStateEntry[]
      activeView: ActiveView
    }
  } catch {
    return {
      folderState: [],
      activeView: { viewId: 'main', name: 'main' },
    }
  }
}

async function buildOpenVaultResponse(vaultPath: string): Promise<OpenVaultResponse> {
  const registry = getRegistry()
  const session = lifecycleState.activeSessionId
    ? registry.get(lifecycleState.activeSessionId) ?? registry.create()
    : registry.create()
  lifecycleState.activeSessionId = session.id

  const state = await buildDaemonState(session)
  const vaultState = await readVaultState(vaultPath)
  return OpenVaultResponseSchema.parse({
    sessionId: session.id,
    writePath: vaultState.writePath,
    vaultState,
    initialProjectedGraph: project(state),
    ...readFolderVisibilitySnapshot(vaultPath),
  })
}

async function closeResources(): Promise<void> {
  for (const resource of [...resources].reverse()) {
    try {
      await resource.closeForVault()
    } catch (error) {
      console.error('vault resource close failed:', error)
    }
  }
}

async function openResources(vaultPath: string): Promise<void> {
  try {
    for (const resource of resources) {
      await resource.openForVault(vaultPath)
    }
  } catch (error) {
    throw new VaultOpenFailedError(
      error instanceof Error ? error.message : 'Vault resource failed to open',
    )
  }
}

async function bindVault(input: OpenVaultRequest, targetVaultPath: string): Promise<void> {
  await mkdir(join(targetVaultPath, '.voicetree'), { recursive: true })
  setVaultPath(targetVaultPath)

  const savedConfig = await getVaultConfigForDirectory(targetVaultPath)
  const configuredWritePath = input.writePath ?? savedConfig?.writePath
  const targetWritePath = configuredWritePath
    ? resolveWritePath(targetVaultPath, configuredWritePath)
    : targetVaultPath

  const result = await setWritePath(targetWritePath)
  if (!result.success) {
    throw new VaultOpenFailedError(result.error ?? `Failed to open vault ${targetVaultPath}`)
  }
}

export async function openVaultWorkflow(input: OpenVaultRequest): Promise<OpenVaultResponse> {
  return await withVaultMutex(async () => {
    const body = OpenVaultRequestSchema.parse(input)
    const targetVaultPath = resolve(body.path)

    if (lifecycleState.activeVaultPath === targetVaultPath) {
      return await buildOpenVaultResponse(targetVaultPath)
    }

    if (lifecycleState.activeVaultPath) {
      await closeResources()
    }

    lifecycleState.activeVaultPath = null
    lifecycleState.activeSessionId = null
    setGraph(createEmptyGraph())

    try {
      await bindVault(body, targetVaultPath)
      await openResources(targetVaultPath)
      lifecycleState.activeVaultPath = targetVaultPath
      return await buildOpenVaultResponse(targetVaultPath)
    } catch (error) {
      throw error instanceof VaultOpenFailedError
        ? error
        : new VaultOpenFailedError(
            error instanceof Error ? error.message : 'Failed to open vault',
          )
    }
  })
}

export async function closeVaultWorkflow(): Promise<void> {
  await withVaultMutex(async () => {
    if (!lifecycleState.activeVaultPath && !getProjectRootWatchedDirectory()) {
      return
    }

    await closeResources()
    lifecycleState.activeVaultPath = null
    lifecycleState.activeSessionId = null
    clearVaultPath()
    setGraph(createEmptyGraph())
  })
}

export function ensureVaultIsOpen(): void {
  if (!getProjectRootWatchedDirectory()) {
    throw new VaultNotOpenError()
  }
}

export function parseOpenVaultBody(rawBody: unknown): OpenVaultRequest {
  return OpenVaultRequestSchema.parse(rawBody)
}

export function isRequestValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError
}
