import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startDaemon, type DaemonHandle } from '@vt/graph-db-server'
import { GraphDbClient } from '../../graph-db-client/src/index.ts'

const LEGACY_PROJECT_RACE_ERROR = /no project.*open|watched directory not initialized/i

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function diagnosticText(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...Object.fromEntries(Object.entries(value)),
    })
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function hasErrorCode(value: unknown, code: string): boolean {
  if (!isRecord(value)) {
    return false
  }
  if (value.code === code) {
    return true
  }
  return Object.values(value).some((entry) => hasErrorCode(entry, code))
}

async function createProject(root: string, name: string): Promise<string> {
  const project = path.join(root, name)
  await mkdir(project, { recursive: true })
  await writeFile(path.join(project, 'alpha.md'), `# ${name} alpha\n`, 'utf8')
  await writeFile(path.join(project, 'beta.md'), `# ${name} beta\n`, 'utf8')
  return project
}

async function collectProjectedGraphReads(
  client: GraphDbClient,
  sessionId: string,
  durationMs: number,
): Promise<unknown[]> {
  const observed: unknown[] = []
  const deadline = Date.now() + durationMs

  while (Date.now() < deadline) {
    try {
      observed.push(await client.getProjectedGraph(sessionId))
    } catch (error) {
      observed.push(error)
    }
    await delay(10)
  }

  return observed
}

describe('project open race regression', () => {
  let root: string
  let projectA: string
  let projectB: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-project-open-race-'))
    projectA = await createProject(root, 'project-a')
    projectB = await createProject(root, 'project-b')
    handle = await startDaemon({
      project: projectA,
      voicetreeHomePath: path.join(root, 'voicetree-home'),
      createStarterIfEmpty: false,
    })
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    await rm(root, { recursive: true, force: true })
  })

  it('does not expose transient project-not-open errors while switching projects', async () => {
    const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${handle!.port}` })

    const openedA = await client.openProject(projectA)
    const reader = collectProjectedGraphReads(client, openedA.sessionId, 2000)

    await delay(50)
    await client.openProject(projectB)

    const observed = await reader
    const legacyFailures = observed
      .map(diagnosticText)
      .filter((text) => LEGACY_PROJECT_RACE_ERROR.test(text))
    const projectNotOpenFailures = observed.filter((value) => hasErrorCode(value, 'project_not_open'))

    expect(legacyFailures).toEqual([])
    expect(projectNotOpenFailures).toEqual([])
  })
})
