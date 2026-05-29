import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyGraph } from '@vt/graph-model'
import { clearWatchFolderState } from '../../../state/watch-folder-store.ts'
import { setGraph } from '../../../state/graph-store.ts'
import { startDaemon, type DaemonHandle } from '../../../daemon/server.ts'
import {
  beginProjectOpen,
  completeProjectOpen,
} from '../../../application/workflows/projectOpenGate.ts'

async function makeTempDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

describe('project routes', () => {
  let project: string
  let voicetreeHomePath: string
  let handles: DaemonHandle[]
  let originalVoicetreeHomePath: string | undefined

  beforeEach(async () => {
    project = await makeTempDir('graphd-project-')
    voicetreeHomePath = await makeTempDir('graphd-voicetree-home-')
    handles = []
    originalVoicetreeHomePath = process.env.VOICETREE_HOME_PATH
    process.env.VOICETREE_HOME_PATH = voicetreeHomePath
    clearWatchFolderState()
    setGraph(createEmptyGraph())
  })

  afterEach(async () => {
    for (const handle of handles) {
      await handle.stop().catch(() => {})
    }
    handles = []
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    if (originalVoicetreeHomePath === undefined) {
      delete process.env.VOICETREE_HOME_PATH
    } else {
      process.env.VOICETREE_HOME_PATH = originalVoicetreeHomePath
    }
    await rm(project, { recursive: true, force: true })
    await rm(voicetreeHomePath, { recursive: true, force: true })
  })

  const start = async (): Promise<DaemonHandle> => {
    const handle = await startDaemon({ project })
    handles.push(handle)
    return handle
  }

  test('GET /project returns mounted project state after cold start', async () => {
    const handle = await start()

    const response = await fetch(`http://127.0.0.1:${handle.port}/project`)

    expect(response.status).toBe(200)
    // Cold start of a fresh project root with no saved config defaults the
    // writeFolderPath to a `voicetree-{day}-{month}` subfolder so we never load
    // the whole project root as a single graph — see resolveDefaultWriteFolderPath.
    const body = await response.json() as { projectRoot: string; readPaths: string[]; writeFolderPath: string }
    expect(body.projectRoot).toBe(project)
    expect(body.writeFolderPath).toMatch(new RegExp(`^${project}/voicetree-\\d{1,2}-\\d{1,2}(-\\d+)?$`))
    expect(body.readPaths).toEqual(expect.arrayContaining([body.writeFolderPath]))
  })

  test('PUT /project/write-path updates the write path', async () => {
    const outPath = join(project, 'out')
    await mkdir(outPath, { recursive: true })
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/project/write-path`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: outPath }),
      },
    )
    const projectState = await fetch(`http://127.0.0.1:${handle.port}/project`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ writeFolderPath: outPath })
    expect(await projectState.json()).toMatchObject({
      projectRoot: project,
      writeFolderPath: outPath,
    })
  })

  test('POST /project/open applies writeFolderPath when re-opening the active project', async () => {
    const outPath = join(project, 'out')
    await mkdir(outPath, { recursive: true })
    const handle = await start()

    const response = await fetch(
      `http://127.0.0.1:${handle.port}/project/open`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: project, writeFolderPath: outPath }),
      },
    )
    const projectState = await fetch(`http://127.0.0.1:${handle.port}/project`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ writeFolderPath: outPath })
    expect(await projectState.json()).toMatchObject({
      projectRoot: project,
      writeFolderPath: outPath,
    })
  })

  test('GET /project waits for an in-flight openProjectWorkflow before reading state', async () => {
    const handle = await start()

    // Simulate an in-flight open by flipping the gate on directly. The daemon
    // has already finished its startup open, so projectRoot IS set — but the
    // gate forces readers to await completion regardless. This proves the
    // wiring: a renderer landing here mid project-switch will not race onto the
    // bare `getProjectRoot()` check.
    beginProjectOpen()

    let readResolved = false
    const reader = fetch(`http://127.0.0.1:${handle.port}/project`).then(
      async (response): Promise<unknown> => {
        readResolved = true
        return await response.json()
      },
    )

    // Yield to the event loop so the read is unambiguously waiting.
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, 50)
    })
    expect(readResolved).toBe(false)

    completeProjectOpen()
    const body = await reader as { projectRoot: string; readPaths: string[]; writeFolderPath: string }
    expect(readResolved).toBe(true)
    expect(body.projectRoot).toBe(project)
    expect(body.writeFolderPath).toMatch(new RegExp(`^${project}/voicetree-\\d{1,2}-\\d{1,2}(-\\d+)?$`))
    expect(body.readPaths).toEqual(expect.arrayContaining([body.writeFolderPath]))
  })

  test('GET /project still 409s when no project is open and no open is pending', async () => {
    // Start a daemon WITHOUT a project: HTTP up, projectRoot null, gate empty.
    const projectless = await startDaemon({})
    handles.push(projectless)

    const response = await fetch(`http://127.0.0.1:${projectless.port}/project`)
    expect(response.status).toBe(409)
    const body = await response.json() as { error?: { code?: string } }
    expect(body.error?.code).toBe('project_not_open')
  })

})
