import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {getProjectDotVoicetreePath} from '@vt/app-config/paths'
import { project } from '@vt/graph-state'
import { traceGraphdSpan } from '@vt/graph-db-server/watch-folder/paths/traceGraphdSpan'
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
import { createDatedSubfolder, findExistingVoicetreeDir } from '@vt/app-config/project'
import { createEmptyGraph } from '@vt/graph-model'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { reconcileGraphWithDisk } from './vault/reconcileGraphWithDisk.ts'
import {
  getReadPaths,
  getWriteFolder,
  resolveWriteFolder,
  setWriteFolder,
} from '@vt/graph-db-server/state/vaultAllowlist'
import {
  clearProjectRoot,
  getProjectRoot,
  setProjectRoot,
} from '@vt/graph-db-server/state/watch-folder-store'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import type { SessionRegistry } from '../session/registry.ts'
import {
  VaultNotOpenError,
  VaultOpenFailedError,
} from '../errors/vaultNotOpen.ts'
import {
  beginVaultOpen,
  completeVaultOpen,
  resetVaultOpenGate,
} from './vaultOpenGate.ts'

export type VaultResource = {
  openForVault(projectRoot: string): Promise<void>
  closeForVault(): Promise<void>
}

type OpenVaultWorkflowInput = OpenVaultRequest & {
  createStarterIfEmpty?: boolean
}

type LifecycleState = {
  activeSessionId: string | null
  registry: SessionRegistry | null
}

const resources: VaultResource[] = []
const lifecycleState: LifecycleState = {
  activeSessionId: null,
  registry: null,
}

let mutexTail: Promise<unknown> = Promise.resolve()

export function configureVaultLifecycle(options: {
  registry: SessionRegistry
}): void {
  lifecycleState.activeSessionId = null
  lifecycleState.registry = options.registry
}

export function resetVaultLifecycle(): void {
  resources.length = 0
  lifecycleState.activeSessionId = null
  lifecycleState.registry = null
  mutexTail = Promise.resolve()
  resetVaultOpenGate()
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

function parseWriteFolder(writeFolderOption: Awaited<ReturnType<typeof getWriteFolder>>): string | null {
  const maybeValue = (writeFolderOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? maybeValue : null
}

async function readVaultState(projectRoot: string): Promise<VaultState> {
  const readPaths = [...(await getReadPaths())]
  const writeFolder = parseWriteFolder(await getWriteFolder()) ?? projectRoot
  return VaultStateSchema.parse({ projectRoot, readPaths, writeFolder })
}

function readFolderVisibilitySnapshot(
  projectRoot: string,
): { folderState: FolderStateEntry[]; activeView: ActiveView } {
  try {
    return getFolderStateForActiveView(projectRoot) as {
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

async function buildOpenVaultResponse(projectRoot: string): Promise<OpenVaultResponse> {
  const registry = getRegistry()
  const session = lifecycleState.activeSessionId
    ? registry.get(lifecycleState.activeSessionId) ?? registry.create()
    : registry.create()
  lifecycleState.activeSessionId = session.id

  const state = await buildDaemonState(session)
  const vaultState = await readVaultState(projectRoot)
  return OpenVaultResponseSchema.parse({
    sessionId: session.id,
    writeFolder: vaultState.writeFolder,
    vaultState,
    initialProjectedGraph: project(state),
    ...readFolderVisibilitySnapshot(projectRoot),
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

async function openResources(projectRoot: string): Promise<void> {
  try {
    for (const resource of resources) {
      await resource.openForVault(projectRoot)
    }
  } catch (error) {
    throw new VaultOpenFailedError(
      error instanceof Error ? error.message : 'Vault resource failed to open',
    )
  }
}

// When opening a project root with no saved config and no caller-supplied
// writeFolder, default to an existing `voicetree-{day}-{month}` subfolder
// or create one. Treating the project root itself as the writeFolder would
// recursively scan every `.md` under it — fine for a small notes folder,
// catastrophic for a source repo. The bare `targetProjectRoot` fallback
// caused vt-graphd to die with `File limit exceeded` when started against
// a monorepo whose nested vaults pushed the .md count past the 1000-file
// guard.
async function resolveDefaultWriteFolder(targetProjectRoot: string): Promise<string> {
  const existing: string | null = await findExistingVoicetreeDir(targetProjectRoot)
  if (existing !== null) return existing
  return await createDatedSubfolder(targetProjectRoot)
}

async function bindVault(input: OpenVaultWorkflowInput, targetProjectRoot: string): Promise<void> {
  await mkdir(getProjectDotVoicetreePath(targetProjectRoot), { recursive: true })
  setProjectRoot(targetProjectRoot)

  const savedConfig = await getVaultConfigForDirectory(targetProjectRoot)
  const configuredWriteFolder = input.writeFolder ?? savedConfig?.writeFolder
  const targetWriteFolder = configuredWriteFolder
    ? resolveWriteFolder(targetProjectRoot, configuredWriteFolder)
    : await resolveDefaultWriteFolder(targetProjectRoot)

  const result = await setWriteFolder(targetWriteFolder, {
    createStarterIfEmpty: input.createStarterIfEmpty,
  })
  if (!result.success) {
    throw new VaultOpenFailedError(result.error ?? `Failed to open vault ${targetProjectRoot}`)
  }
  await reconcileGraphWithDisk()
}

export async function openVaultWorkflow(input: OpenVaultWorkflowInput): Promise<OpenVaultResponse> {
  return await traceGraphdSpan('daemon.open-vault', async (span) => {
    return await withVaultMutex(async () => {
      beginVaultOpen()
      try {
        const body = OpenVaultRequestSchema.parse(input)
        const targetProjectRoot = resolve(body.path)
        const currentProjectRoot = getProjectRoot()
        span.setAttribute('targetVaultPath', targetProjectRoot)
        span.setAttribute('priorActiveVaultPath', currentProjectRoot ?? '')

        if (currentProjectRoot && resolve(currentProjectRoot) === targetProjectRoot) {
          await bindVault(
            { ...body, createStarterIfEmpty: input.createStarterIfEmpty },
            targetProjectRoot,
          )
          span.setAttribute('outcome', 'reuse-current')
          return await buildOpenVaultResponse(targetProjectRoot)
        }

        if (currentProjectRoot) {
          span.setAttribute('switchedFromActive', true)
          await closeResources()
        }

        lifecycleState.activeSessionId = null
        setGraph(createEmptyGraph())

        try {
          await bindVault(
            { ...body, createStarterIfEmpty: input.createStarterIfEmpty },
            targetProjectRoot,
          )
          await openResources(targetProjectRoot)
          span.setAttribute('outcome', 'opened')
          return await buildOpenVaultResponse(targetProjectRoot)
        } catch (error) {
          span.setAttribute('outcome', 'open-failed')
          span.setAttribute('errorMessage', error instanceof Error ? error.message : String(error))
          await closeResources()
          clearProjectRoot()
          throw error instanceof VaultOpenFailedError
            ? error
            : new VaultOpenFailedError(
                error instanceof Error ? error.message : 'Failed to open vault',
              )
        }
      } finally {
        completeVaultOpen()
      }
    })
  })
}

export async function closeVaultWorkflow(): Promise<void> {
  await traceGraphdSpan('daemon.close-vault', async (span) => {
    await withVaultMutex(async () => {
      const currentProjectRoot = getProjectRoot()
      span.setAttribute('priorActiveVaultPath', currentProjectRoot ?? '')
      if (!currentProjectRoot) {
        span.setAttribute('outcome', 'no-op')
        return
      }

      await closeResources()
      lifecycleState.activeSessionId = null
      clearProjectRoot()
      setGraph(createEmptyGraph())
      span.setAttribute('outcome', 'closed')
    })
  })
}

export function ensureVaultIsOpen(): void {
  if (!getProjectRoot()) {
    throw new VaultNotOpenError()
  }
}

export function parseOpenVaultBody(rawBody: unknown): OpenVaultRequest {
  return OpenVaultRequestSchema.parse(rawBody)
}

export function isRequestValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError
}
