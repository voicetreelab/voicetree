import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk, loadVaultPathAdditively } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk'
import type { Graph, GraphNode, GraphDelta } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import type { FileLimitExceededError } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce'

describe('loadGraphFromDisk', () => {
  const testVaultPaths: { testVault: string; emptyVault: string; } = {
    testVault: '',
    emptyVault: ''
  }

  beforeAll(async () => {
    // Create temp directory for test vault
    const tmpDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'))
    testVaultPaths.testVault = path.join(tmpDir, 'test-vault')
    testVaultPaths.emptyVault = path.join(tmpDir, 'empty-vault')
    const testVaultPath: string = testVaultPaths.testVault
    const emptyVaultPath: string = testVaultPaths.emptyVault

    await fs.mkdir(testVaultPath, { recursive: true })
    await fs.mkdir(emptyVaultPath, { recursive: true })

    // Create test files
    await fs.writeFile(
      path.join(testVaultPath, 'node1.md'),
      `---
node_id: "1"
title: "Node One"
summary: "First node"
color: "#FF0000"
---
# Node One Content

This is node one. It links to [[node2]].`
    )

    await fs.writeFile(
      path.join(testVaultPath, 'node2.md'),
      `---
node_id: "2"
title: "Node Two"
summary: "Second node"
---
# Node Two Content

This is node two. It links to [[node1]] and [[node3]].`
    )

    await fs.writeFile(
      path.join(testVaultPath, 'node3.md'),
      `# Node Three

This is node three with no frontmatter. No links here.`
    )

    // Create nested structure
    await fs.mkdir(path.join(testVaultPath, 'subfolder'), { recursive: true })
    await fs.writeFile(
      path.join(testVaultPath, 'subfolder', 'nested.md'),
      `---
node_id: "nested"
title: "Nested Node"
---
# Nested

This is in a subfolder.`
    )
  })

  afterAll(async () => {
    // Clean up
    await fs.rm(path.dirname(testVaultPaths.testVault), { recursive: true, force: true })
  })

  it('should load empty graph from empty directory', async () => {
    const r1: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.emptyVault])
    if (E.isLeft(r1)) throw new Error('Expected Right')
    const graph: Graph = r1.right

    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  it('should load all nodes from vault', async () => {
    const r2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r2)) throw new Error('Expected Right')
    const graph: Graph = r2.right

    expect(Object.keys(graph.nodes)).toHaveLength(4)
    expect(graph.nodes['node1.md']).toBeDefined()
    expect(graph.nodes['node2.md']).toBeDefined()
    expect(graph.nodes['node3.md']).toBeDefined()
    expect(graph.nodes['subfolder/nested.md']).toBeDefined()
  })

  it('should parse node properties from frontmatter', async () => {
    const r3: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r3)) throw new Error('Expected Right')
    const graph: Graph = r3.right

    const node1: GraphNode = graph.nodes['node1.md']
    // contentWithoutYamlOrLinks should NOT contain YAML frontmatter (it's stripped)
    expect(node1.contentWithoutYamlOrLinks).not.toContain('title: "Node One"')
    expect(node1.contentWithoutYamlOrLinks).not.toContain('summary: "First node"')
    expect(node1.contentWithoutYamlOrLinks).toContain('# Node One Content')
    expect(node1.contentWithoutYamlOrLinks).toContain('This is node one')
    // But metadata should be parsed correctly
    expect(O.isSome(node1.nodeUIMetadata.color)).toBe(true)
    if (O.isSome(node1.nodeUIMetadata.color)) {
      expect(node1.nodeUIMetadata.color.value).toBe('#FF0000')
    }
  })

  it('should use filename as node_id when missing from frontmatter', async () => {
    const r4: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r4)) throw new Error('Expected Right')
    const graph: Graph = r4.right

    expect(graph.nodes['node3.md']).toBeDefined()
    expect(graph.nodes['node3.md'].absoluteFilePathIsID).toBe('node3.md')
  })

  it('should extract title from heading when not in frontmatter', async () => {
    const r5: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r5)) throw new Error('Expected Right')
    const graph: Graph = r5.right

    expect(graph.nodes['node3.md'].contentWithoutYamlOrLinks).toContain('# Node Three')
  })

  it('should build outgoingEdges from wikilinks', async () => {
    const r6: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r6)) throw new Error('Expected Right')
    const graph: Graph = r6.right

    expect(graph.nodes['node1.md'].outgoingEdges).toEqual([{ targetId: 'node2.md', label: 'This is node one. It links to' }])
    expect(graph.nodes['node2.md'].outgoingEdges.some((e: { targetId: string }) => e.targetId === 'node1.md')).toBe(true)
    expect(graph.nodes['node2.md'].outgoingEdges.some((e: { targetId: string }) => e.targetId === 'node3.md')).toBe(true)
  })

  it('should handle nodes with no links', async () => {
    const r7: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r7)) throw new Error('Expected Right')
    const graph: Graph = r7.right

    expect(graph.nodes['node3.md'].outgoingEdges).toEqual([])
  })

  it('should handle nested directory structure', async () => {
    const r8: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r8)) throw new Error('Expected Right')
    const graph: Graph = r8.right

    expect(graph.nodes['subfolder/nested.md']).toBeDefined()
    expect(graph.nodes['subfolder/nested.md'].contentWithoutYamlOrLinks).toContain('# Nested')
  })

  it('should derive title from Markdown heading (single source of truth)', async () => {
    const r9: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r9)) throw new Error('Expected Right')
    const graph: Graph = r9.right

    const node1: GraphNode = graph.nodes['node1.md']
    // Node1 has BOTH frontmatter title "Node One" AND heading "# Node One Content"
    // Markdown is the single source of truth - title comes from heading via getNodeTitle
    expect(getNodeTitle(node1)).toBe('Node One Content')
    expect(getNodeTitle(node1)).not.toBe('Node One') // YAML title is ignored
  })

  it('should be a pure IO function (same input -> same IO)', async () => {
    const r10: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r10)) throw new Error('Expected Right')
    const graph1: Graph = r10.right
    const r11: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testVaultPaths.testVault])
    if (E.isLeft(r11)) throw new Error('Expected Right')
    const graph2: Graph = r11.right

    expect(Object.keys(graph1.nodes).sort()).toEqual(Object.keys(graph2.nodes).sort())
  })
})

describe('loadVaultPathAdditively', () => {
  let tmpDir: string
  let watchedDir: string
  let primaryVaultPath: string
  let secondaryVaultPath: string

  beforeAll(async () => {
    // Create temp directory structure:
    // tmpDir/
    //   project/           <- watchedDir
    //     primary-vault/   <- primaryVaultPath (existing nodes)
    //       existing.md
    //     secondary-vault/ <- secondaryVaultPath (new nodes to add)
    //       newfile1.md
    //       newfile2.md
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'additive-test-'))
    watchedDir = path.join(tmpDir, 'project')
    primaryVaultPath = path.join(watchedDir, 'primary-vault')
    secondaryVaultPath = path.join(watchedDir, 'secondary-vault')

    await fs.mkdir(primaryVaultPath, { recursive: true })
    await fs.mkdir(secondaryVaultPath, { recursive: true })

    // Create existing node in primary vault
    await fs.writeFile(
      path.join(primaryVaultPath, 'existing.md'),
      `# Existing Node

This is an existing node.`
    )

    // Create new nodes in secondary vault
    await fs.writeFile(
      path.join(secondaryVaultPath, 'newfile1.md'),
      `# New File 1

Content for new file 1.`
    )
    await fs.writeFile(
      path.join(secondaryVaultPath, 'newfile2.md'),
      `# New File 2

Content for new file 2. Links to [[existing]].`
    )
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should merge new vault nodes into existing graph', async () => {
    // GIVEN: Load initial graph from primary vault
    const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([primaryVaultPath])
    if (E.isLeft(initialResult)) throw new Error('Expected Right')
    const existingGraph: Graph = initialResult.right

    expect(Object.keys(existingGraph.nodes)).toHaveLength(1)
    expect(existingGraph.nodes['primary-vault/existing.md']).toBeDefined()

    // WHEN: Load secondary vault additively
    const additiveResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
      await loadVaultPathAdditively(secondaryVaultPath, existingGraph)

    // THEN: Result should be Right with merged graph
    if (E.isLeft(additiveResult)) throw new Error('Expected Right')
    const { graph: mergedGraph, delta } = additiveResult.right

    // THEN: Merged graph should contain all nodes (original + new)
    expect(Object.keys(mergedGraph.nodes)).toHaveLength(3)
    expect(mergedGraph.nodes['primary-vault/existing.md']).toBeDefined()
    expect(mergedGraph.nodes['secondary-vault/newfile1.md']).toBeDefined()
    expect(mergedGraph.nodes['secondary-vault/newfile2.md']).toBeDefined()

    // THEN: Delta should only contain the new nodes
    expect(delta).toHaveLength(2)
    const deltaNodeIds: readonly string[] = delta.map(d => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
    expect(deltaNodeIds).toContain('secondary-vault/newfile1.md')
    expect(deltaNodeIds).toContain('secondary-vault/newfile2.md')
    expect(deltaNodeIds).not.toContain('primary-vault/existing.md')
  })

  it('should preserve existing node positions when merging', async () => {
    // GIVEN: Load initial graph and set a position on existing node
    const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([primaryVaultPath])
    if (E.isLeft(initialResult)) throw new Error('Expected Right')

    const existingGraph: Graph = createGraph({
      ...initialResult.right.nodes,
      'primary-vault/existing.md': {
        ...initialResult.right.nodes['primary-vault/existing.md'],
        nodeUIMetadata: {
          ...initialResult.right.nodes['primary-vault/existing.md'].nodeUIMetadata,
          position: O.some({ x: 100, y: 200 })
        }
      }
    })

    // WHEN: Load secondary vault additively
    const additiveResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
      await loadVaultPathAdditively(secondaryVaultPath, existingGraph)

    if (E.isLeft(additiveResult)) throw new Error('Expected Right')
    const { graph: mergedGraph } = additiveResult.right

    // THEN: Existing node position should be preserved
    const existingNode: GraphNode = mergedGraph.nodes['primary-vault/existing.md']
    expect(O.isSome(existingNode.nodeUIMetadata.position)).toBe(true)
    if (O.isSome(existingNode.nodeUIMetadata.position)) {
      expect(existingNode.nodeUIMetadata.position.value).toEqual({ x: 100, y: 200 })
    }
  })

  it('should return empty delta when adding empty vault', async () => {
    // GIVEN: Existing graph with nodes
    const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([primaryVaultPath])
    if (E.isLeft(initialResult)) throw new Error('Expected Right')
    const existingGraph: Graph = initialResult.right

    // AND: Create an empty vault
    const emptyVaultPath: string = path.join(watchedDir, 'empty-vault')
    await fs.mkdir(emptyVaultPath, { recursive: true })

    // WHEN: Load empty vault additively
    const additiveResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
      await loadVaultPathAdditively(emptyVaultPath, existingGraph)

    if (E.isLeft(additiveResult)) throw new Error('Expected Right')
    const { graph: mergedGraph, delta } = additiveResult.right

    // THEN: Graph should be unchanged
    expect(Object.keys(mergedGraph.nodes)).toHaveLength(1)

    // THEN: Delta should be empty
    expect(delta).toHaveLength(0)
  })
})
