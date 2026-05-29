import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GraphDelta, GraphNode } from '@vt/graph-model'

import {
  startDaemon,
  type DaemonHandle,
} from '../src/daemon/index.ts'

function makeNode(absolutePath: string, content: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: absolutePath,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

function upsertDelta(node: GraphNode): GraphDelta {
  return [{ type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }]
}

describe('@vt/graph-db-server graph delta failure handling', () => {
  let root: string
  let project: string
  let handle: DaemonHandle | null
  let baseUrl: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vt-graphd-delta-failure-'))
    project = path.join(root, 'project')
    await mkdir(project, { recursive: true })
    handle = await startDaemon({
      project,
      voicetreeHomePath: path.join(root, 'voicetree-home'),
      createStarterIfEmpty: false,
    })
    baseUrl = `http://127.0.0.1:${handle.port}`
  })

  afterEach(async () => {
    await handle?.stop().catch(() => {})
    handle = null
    await rm(root, { recursive: true, force: true })
  })

  it('leaves graph memory unchanged when a delta cannot be persisted', async () => {
    const blockingFile = path.join(project, 'not-a-directory')
    await writeFile(blockingFile, 'blocks child writes', 'utf8')
    const nodePath = path.join(blockingFile, 'child.md')

    const response = await fetch(`${baseUrl}/graph/delta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(upsertDelta(makeNode(nodePath, '# Cannot Persist\n'))),
    })
    const body = await response.json() as { code?: string }

    expect(response.status).toBe(500)
    expect(body.code).toBe('GRAPH_DELTA_APPLY_FAILED')

    const graph = await (await fetch(`${baseUrl}/graph`)).json() as {
      nodes: Record<string, unknown>
    }
    expect(graph.nodes[nodePath]).toBeUndefined()
  })
})
