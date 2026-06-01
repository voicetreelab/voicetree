import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createDaemonApp } from '../../daemonApp.ts'
import { SessionRegistry } from '../../../application/session/registry.ts'
import {
  clearWatchFolderState,
  setProjectRoot,
} from '../../../state/watch-folder-store.ts'
import { consumeBroadcastSuppression } from '../../../data/watch-folder/pending-writes.ts'

describe('write markdown file route', () => {
  let root: string
  let project: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'graphd-write-markdown-route-'))
    project = path.join(root, 'project')
    await mkdir(project, { recursive: true })
    clearWatchFolderState()
    setProjectRoot(project)
  })

  afterEach(async () => {
    clearWatchFolderState()
    await rm(root, { recursive: true, force: true })
  })

  function app(): ReturnType<typeof createDaemonApp> {
    return createDaemonApp({
      onShutdown: () => undefined,
      readHealth: () => ({
        version: '0.2.0',
        project,
        uptimeSeconds: 0,
        sessionCount: 0,
        owner: null,
      }),
      registry: new SessionRegistry(),
    })
  }

  test('writes editor body while preserving frontmatter and pending editor suppression', async () => {
    const filePath = path.join(project, 'note.md')
    await writeFile(filePath, '---\nposition: {x:1,y:2}\n---\n# Old\n', 'utf8')

    const response = await app().request('/graph/write-markdown-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        absolutePath: filePath,
        body: '# New\n\nBody\n',
        editorId: 'editor-route',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, absolutePath: filePath, preservedSuffix: null })
    await expect(readFile(filePath, 'utf8')).resolves.toBe(
      '---\nposition: {x:1,y:2}\n---\n# New\n\nBody\n',
    )
    expect([...consumeBroadcastSuppression(filePath)]).toEqual(['editor-route'])
  })

  test('rejects paths outside the open project', async () => {
    const outsidePath = path.join(root, 'outside.md')
    const response = await app().request('/graph/write-markdown-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        absolutePath: outsidePath,
        body: '# Outside\n',
        editorId: 'editor-route',
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 'PATH_OUTSIDE_PROJECT',
      error: 'Path must be inside the open project',
    })
  })

  test('resolves folder node paths to index.md', async () => {
    const folderPath = path.join(project, 'folder')
    await mkdir(folderPath, { recursive: true })

    const response = await app().request('/graph/write-markdown-file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        absolutePath: `${folderPath}/`,
        body: '# Folder Index\n',
        editorId: 'folder-editor',
      }),
    })

    expect(response.status).toBe(200)
    const indexPath = path.join(folderPath, 'index.md')
    await expect(response.json()).resolves.toEqual({ ok: true, absolutePath: indexPath, preservedSuffix: null })
    await expect(readFile(indexPath, 'utf8')).resolves.toBe('# Folder Index\n')
  })
})
