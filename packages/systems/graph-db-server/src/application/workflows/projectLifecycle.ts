import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {getProjectDotVoicetreePath} from '@vt/paths'
import { project } from '@vt/graph-state'
import { traceGraphdSpan } from '@vt/graph-db-server/watch-folder/paths/traceGraphdSpan'
import {
  OpenProjectRequestSchema,
  OpenProjectResponseSchema,
  ProjectStateSchema,
  type ActiveView,
  type FolderStateEntry,
  type OpenProjectRequest,
  type OpenProjectResponse,
  type ProjectState,
} from '@vt/graph-db-server/contract'
import { getFolderStateForActiveView } from '@vt/graph-db-server/views/folderStateOps'
import { getProjectConfigForDirectory } from '@vt/app-config/project-config'
import { createDatedSubfolder, findExistingVoicetreeDir } from '@vt/app-config/project'
import { createEmptyGraph } from '@vt/graph-model'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { reconcileGraphWithDisk } from './project/reconcileGraphWithDisk.ts'
import {
  getReadPaths,
  getWriteFolderPath,
  resolveWriteFolderPath,
  setWriteFolderPath,
} from '@vt/graph-db-server/state/projectAllowlist'
import {
  clearProjectRoot,
  getProjectRoot,
  setProjectRoot,
} from '@vt/graph-db-server/state/watch-folder-store'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import type { SessionRegistry } from '../session/registry.ts'
import {
  ProjectNotOpenError,
  ProjectOpenFailedError,
} from '../errors/projectNotOpen.ts'
import {
  beginProjectOpen,
  completeProjectOpen,
  resetProjectOpenGate,
} from './projectOpenGate.ts'

export type ProjectResource = {
  openForProject(projectRoot: string): Promise<void>
  closeForProject(): Promise<void>
}

type OpenProjectWorkflowInput = OpenProjectRequest & {
  createStarterIfEmpty?: boolean
}

type LifecycleState = {
  activeSessionId: string | null
  registry: SessionRegistry | null
}

const resources: ProjectResource[] = []
const lifecycleState: LifecycleState = {
  activeSessionId: null,
  registry: null,
}

let mutexTail: Promise<unknown> = Promise.resolve()

export function configureProjectLifecycle(options: {
  registry: SessionRegistry
}): void {
  lifecycleState.activeSessionId = null
  lifecycleState.registry = options.registry
}

export function resetProjectLifecycle(): void {
  resources.length = 0
  lifecycleState.activeSessionId = null
  lifecycleState.registry = null
  mutexTail = Promise.resolve()
  resetProjectOpenGate()
}

export async function withProjectMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexTail.then(fn, fn)
  mutexTail = run.catch(() => undefined)
  return await run
}

export function registerProjectResource(resource: ProjectResource): void {
  resources.push(resource)
}

function getRegistry(): SessionRegistry {
  if (!lifecycleState.registry) {
    throw new ProjectOpenFailedError('Project lifecycle has not been initialized')
  }
  return lifecycleState.registry
}

function parseWriteFolderPath(writeFolderPathOption: Awaited<ReturnType<typeof getWriteFolderPath>>): string | null {
  const maybeValue = (writeFolderPathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? maybeValue : null
}

async function readProjectState(projectRoot: string): Promise<ProjectState> {
  const readPaths = [...(await getReadPaths())]
  const writeFolderPath = parseWriteFolderPath(await getWriteFolderPath()) ?? projectRoot
  return ProjectStateSchema.parse({ projectRoot, readPaths, writeFolderPath })
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

async function buildOpenProjectResponse(projectRoot: string): Promise<OpenProjectResponse> {
  const registry = getRegistry()
  const session = lifecycleState.activeSessionId
    ? registry.get(lifecycleState.activeSessionId) ?? registry.create()
    : registry.create()
  lifecycleState.activeSessionId = session.id

  const state = await buildDaemonState(session)
  const projectState = await readProjectState(projectRoot)
  return OpenProjectResponseSchema.parse({
    sessionId: session.id,
    writeFolderPath: projectState.writeFolderPath,
    projectState,
    initialProjectedGraph: project(state),
    ...readFolderVisibilitySnapshot(projectRoot),
  })
}

async function closeResources(): Promise<void> {
  for (const resource of [...resources].reverse()) {
    try {
      await resource.closeForProject()
    } catch (error) {
      console.error('project resource close failed:', error)
    }
  }
}

async function openResources(projectRoot: string): Promise<void> {
  try {
    for (const resource of resources) {
      await resource.openForProject(projectRoot)
    }
  } catch (error) {
    throw new ProjectOpenFailedError(
      error instanceof Error ? error.message : 'Project resource failed to open',
    )
  }
}

// When opening a project root with no saved config and no caller-supplied
// writeFolderPath, default to an existing `voicetree-{day}-{month}` subfolder
// or create one. Treating the project root itself as the writeFolderPath would
// recursively scan every `.md` under it — fine for a small notes folder,
// catastrophic for a source repo. The bare `targetProjectRoot` fallback
// caused vt-graphd to die with `File limit exceeded` when started against
// a monorepo whose nested projects pushed the .md count past the 1000-file
// guard.
async function resolveDefaultWriteFolderPath(targetProjectRoot: string): Promise<string> {
  const existing: string | null = await findExistingVoicetreeDir(targetProjectRoot)
  if (existing !== null) return existing
  return await createDatedSubfolder(targetProjectRoot)
}

async function bindProject(input: OpenProjectWorkflowInput, targetProjectRoot: string): Promise<void> {
  await mkdir(getProjectDotVoicetreePath(targetProjectRoot), { recursive: true })
  setProjectRoot(targetProjectRoot)

  const savedConfig = await getProjectConfigForDirectory(targetProjectRoot)
  const configuredWriteFolderPath = input.writeFolderPath ?? savedConfig?.writeFolderPath
  const targetWriteFolderPath = configuredWriteFolderPath
    ? resolveWriteFolderPath(targetProjectRoot, configuredWriteFolderPath)
    : await resolveDefaultWriteFolderPath(targetProjectRoot)

  const result = await setWriteFolderPath(targetWriteFolderPath, {
    createStarterIfEmpty: input.createStarterIfEmpty,
  })
  if (!result.success) {
    throw new ProjectOpenFailedError(result.error ?? `Failed to open project ${targetProjectRoot}`)
  }
  await reconcileGraphWithDisk()
}

export async function openProjectWorkflow(input: OpenProjectWorkflowInput): Promise<OpenProjectResponse> {
  return await traceGraphdSpan('daemon.open-project', async (span) => {
    return await withProjectMutex(async () => {
      beginProjectOpen()
      try {
        const body = OpenProjectRequestSchema.parse(input)
        const targetProjectRoot = resolve(body.path)
        const currentProjectRoot = getProjectRoot()
        span.setAttribute('targetProjectPath', targetProjectRoot)
        span.setAttribute('priorActiveProjectPath', currentProjectRoot ?? '')

        if (currentProjectRoot && resolve(currentProjectRoot) === targetProjectRoot) {
          await bindProject(
            { ...body, createStarterIfEmpty: input.createStarterIfEmpty },
            targetProjectRoot,
          )
          span.setAttribute('outcome', 'reuse-current')
          return await buildOpenProjectResponse(targetProjectRoot)
        }

        if (currentProjectRoot) {
          span.setAttribute('switchedFromActive', true)
          await closeResources()
        }

        lifecycleState.activeSessionId = null
        setGraph(createEmptyGraph())

        try {
          await bindProject(
            { ...body, createStarterIfEmpty: input.createStarterIfEmpty },
            targetProjectRoot,
          )
          await openResources(targetProjectRoot)
          span.setAttribute('outcome', 'opened')
          return await buildOpenProjectResponse(targetProjectRoot)
        } catch (error) {
          span.setAttribute('outcome', 'open-failed')
          span.setAttribute('errorMessage', error instanceof Error ? error.message : String(error))
          await closeResources()
          clearProjectRoot()
          throw error instanceof ProjectOpenFailedError
            ? error
            : new ProjectOpenFailedError(
                error instanceof Error ? error.message : 'Failed to open project',
              )
        }
      } finally {
        completeProjectOpen()
      }
    })
  })
}

export async function closeProjectWorkflow(): Promise<void> {
  await traceGraphdSpan('daemon.close-project', async (span) => {
    await withProjectMutex(async () => {
      const currentProjectRoot = getProjectRoot()
      span.setAttribute('priorActiveProjectPath', currentProjectRoot ?? '')
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

export function ensureProjectIsOpen(): void {
  if (!getProjectRoot()) {
    throw new ProjectNotOpenError()
  }
}

export function parseOpenProjectBody(rawBody: unknown): OpenProjectRequest {
  return OpenProjectRequestSchema.parse(rawBody)
}

export function isRequestValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError
}
