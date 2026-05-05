import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { IndexPipeline, Search, Store } from '../src'
import { KnowledgeGraph } from '../src/lib/graph.js'
import type { Embedder } from '../src/lib/embedder.js'

const fakeEmbedder = {
  async embed(text: string): Promise<Float32Array> {
    const vector = new Float32Array(384)
    for (let index = 0; index < text.length; index++) {
      vector[index % vector.length] += text.charCodeAt(index) / 1000
    }
    return vector
  },
} as unknown as Embedder

describe('knowledge-graph system contract', () => {
  let root: string
  let vault: string
  let store: Store | undefined

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'kg-system-'))
    vault = path.join(root, 'vault')
    await mkdir(path.join(vault, 'People'), { recursive: true })
    await mkdir(path.join(vault, 'Concepts'), { recursive: true })
    await mkdir(path.join(vault, 'Projects'), { recursive: true })
    store = new Store(path.join(root, 'kg.db'))
  })

  afterEach(async () => {
    store?.close()
    await rm(root, { recursive: true, force: true })
  })

  it('indexes a local vault and queries search, traversal, communities, bridges, and incremental updates', async () => {
    await writeFile(
      path.join(vault, 'People', 'Alice.md'),
      [
        '---',
        'aliases:',
        '  - A. Smith',
        'tags:',
        '  - systems',
        '---',
        '# Alice',
        '',
        'Alice works on resilient components with [[Concepts/Widget Theory]] and [[Projects/Acme]].',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(vault, 'People', 'Bob.md'),
      '# Bob\n\nBob also studies [[Concepts/Widget Theory]].\n',
      'utf8',
    )
    await writeFile(
      path.join(vault, 'Concepts', 'Widget Theory.md'),
      '# Widget Theory\n\nA resilient components framework linked to [[Projects/Acme]].\n',
      'utf8',
    )
    await writeFile(
      path.join(vault, 'Projects', 'Acme.md'),
      '# Acme\n\nDelivery project.\n',
      'utf8',
    )

    expect(store).toBeDefined()
    const activeStore = store as Store
    const pipeline = new IndexPipeline(activeStore, fakeEmbedder)
    const firstStats = await pipeline.index(vault)
    expect(firstStats).toMatchObject({
      nodesIndexed: 4,
      edgesIndexed: 4,
      stubNodesCreated: 0,
    })

    const kg = KnowledgeGraph.fromStore(activeStore)
    expect(kg.nodeCount()).toBe(4)
    expect(kg.edgeCount()).toBe(4)
    expect(activeStore.searchFullText('resilient components')).toContainEqual(expect.objectContaining({
      nodeId: 'People/Alice.md',
      title: 'Alice',
    }))
    expect(new Search(activeStore, fakeEmbedder).fulltext('framework', 2).map((hit) => hit.title)).toContain(
      'Widget Theory',
    )
    expect(kg.neighbors('People/Alice.md', 1).map((node) => node.title).sort()).toEqual([
      'Acme',
      'Widget Theory',
    ])
    expect(kg.findPaths('People/Alice.md', 'Projects/Acme.md', 2)).toHaveLength(2)
    expect(kg.commonNeighbors('People/Alice.md', 'People/Bob.md')).toEqual([
      { id: 'Concepts/Widget Theory.md', title: 'Widget Theory' },
    ])
    expect(kg.subgraph('Concepts/Widget Theory.md', 1).nodes.map((node) => node.title).sort()).toEqual([
      'Acme',
      'Alice',
      'Bob',
      'Widget Theory',
    ])
    expect(activeStore.getAllCommunities().length).toBeGreaterThan(0)
    expect(kg.bridges(2).length).toBeGreaterThan(0)
    expect(kg.centralNodes(2).length).toBeGreaterThan(0)

    await rm(path.join(vault, 'People', 'Bob.md'))
    const secondStats = await pipeline.index(vault)
    expect(secondStats.nodesSkipped).toBe(3)
    expect(activeStore.getNode('People/Bob.md')).toBeUndefined()
    expect(KnowledgeGraph.fromStore(activeStore).neighbors('Concepts/Widget Theory.md', 1).map((node) => node.title)).not.toContain(
      'Bob',
    )
  })
})
