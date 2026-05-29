import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createEmptyGraph } from '@vt/graph-model'
import { type DaemonHandle, startDaemon } from '@vt/graph-db-server/server'
import { setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearWatchFolderState } from '@vt/graph-db-server/state/watch-folder-store'
import { GraphDbClient } from '../src/GraphDbClient.ts'
import { ProjectNotOpenError, ProjectOpenFailedError } from '../src/errors.ts'

describe('GraphDbClient project lifecycle API', () => {
  let root: string
  let project: string
  let handle: DaemonHandle | null

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'graph-db-client-open-project-'))
    project = join(root, 'project')
    await mkdir(project, { recursive: true })
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    handle = await startDaemon({
      project,
      voicetreeHomePath: join(root, 'voicetree-home'),
      createStarterIfEmpty: false,
    })
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    clearWatchFolderState()
    setGraph(createEmptyGraph())
    await rm(root, { recursive: true, force: true })
  })

  test('opens and closes a project with typed response and typed 409 error', async () => {
    const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${handle!.port}` })
    await writeFile(join(project, 'existing.md'), '# Existing\n', 'utf8')

    const opened = await client.openProject(project, { writeFolderPath: project })

    expect(opened.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    // setWriteFolderPath seeds the writeFolderPath as 'expanded' so the sidebar can show
    // its contents on mount. Children remain collapsed by default.
    expect(opened.projectState).toMatchObject({
      projectRoot: project,
      writeFolderPath: project,
    })
    expect(opened.projectState.readPaths).toContain(project)
    expect(opened.folderState).toContainEqual([project, 'expanded'])
    expect(opened.activeView).toMatchObject({ name: 'main' })
    expect(opened.activeView.viewId).toEqual(expect.any(String))

    await client.closeProject()

    await expect(client.getProject()).rejects.toBeInstanceOf(ProjectNotOpenError)
  })

  test('maps project_open_failed 409 responses to ProjectOpenFailedError', async () => {
    const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${handle!.port}` })
    const filePath = join(root, 'not-a-directory')
    await writeFile(filePath, 'not a project', 'utf8')

    await expect(client.openProject(filePath)).rejects.toBeInstanceOf(ProjectOpenFailedError)
  })
})
