import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk, loadProjectPathAdditively } from '@vt/graph-db-server/graph/loadGraphFromDisk'
import type { FileLimitExceededError } from '@vt/graph-db-server/graph/fileLimitEnforce'
import type { Graph, GraphNode, GraphDelta } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'

describe('loadGraphFromDisk', () => {
  const testProjectPaths: { testProject: string; emptyProject: string; } = {
    testProject: '',
    emptyProject: ''
  }

  beforeAll(async () => {
    // Create temp directory for test project
    const tmpDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'))
    testProjectPaths.testProject = path.join(tmpDir, 'test-project')
    testProjectPaths.emptyProject = path.join(tmpDir, 'empty-project')
    const testProjectPath: string = testProjectPaths.testProject
    const emptyProjectPath: string = testProjectPaths.emptyProject

    await fs.mkdir(testProjectPath, { recursive: true })
    await fs.mkdir(emptyProjectPath, { recursive: true })

    // Create test files
    await fs.writeFile(
      path.join(testProjectPath, 'node1.md'),
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
      path.join(testProjectPath, 'node2.md'),
      `---
node_id: "2"
title: "Node Two"
summary: "Second node"
---
# Node Two Content

This is node two. It links to [[node1]] and [[node3]].`
    )

    await fs.writeFile(
      path.join(testProjectPath, 'node3.md'),
      `# Node Three

This is node three with no frontmatter. No links here.`
    )

    // Create nested structure
    await fs.mkdir(path.join(testProjectPath, 'subfolder'), { recursive: true })
    await fs.writeFile(
      path.join(testProjectPath, 'subfolder', 'nested.md'),
      `---
node_id: "nested"
title: "Nested Node"
---
# Nested

This is in a subfolder.`
    )

    // Create image file for testing image node loading
    // Write a minimal PNG file (1x1 transparent pixel)
    const minimalPng: Buffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82 // IEND chunk
    ])
    await fs.writeFile(path.join(testProjectPath, 'test-image.png'), minimalPng)
  })

  afterAll(async () => {
    // Clean up
    await fs.rm(path.dirname(testProjectPaths.testProject), { recursive: true, force: true })
  })

  it('should load empty graph from empty directory', async () => {
    const r1: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.emptyProject])
    if (E.isLeft(r1)) throw new Error('Expected Right')
    const graph: Graph = r1.right

    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  it('should load all nodes from project including images', async () => {
    const r2: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r2)) throw new Error('Expected Right')
    const graph: Graph = r2.right

    // Node IDs are now absolute paths (4 markdown + 1 image)
    expect(Object.keys(graph.nodes)).toHaveLength(5)
    expect(graph.nodes[path.join(testProjectPaths.testProject, 'node1.md')]).toBeDefined()
    expect(graph.nodes[path.join(testProjectPaths.testProject, 'node2.md')]).toBeDefined()
    expect(graph.nodes[path.join(testProjectPaths.testProject, 'node3.md')]).toBeDefined()
    expect(graph.nodes[path.join(testProjectPaths.testProject, 'subfolder/nested.md')]).toBeDefined()
    expect(graph.nodes[path.join(testProjectPaths.testProject, 'test-image.png')]).toBeDefined()
  })

  it('should load image nodes with empty content and no edges', async () => {
    const r: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r)) throw new Error('Expected Right')
    const graph: Graph = r.right

    const imageNode: GraphNode = graph.nodes[path.join(testProjectPaths.testProject, 'test-image.png')]
    expect(imageNode).toBeDefined()
    expect(imageNode.contentWithoutYamlOrLinks).toBe('')
    expect(imageNode.outgoingEdges).toEqual([])
  })

  it('should parse node properties from frontmatter', async () => {
    const r3: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r3)) throw new Error('Expected Right')
    const graph: Graph = r3.right

    const node1: GraphNode = graph.nodes[path.join(testProjectPaths.testProject, 'node1.md')]
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

  it('should use absolute file path as node_id', async () => {
    const r4: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r4)) throw new Error('Expected Right')
    const graph: Graph = r4.right

    const node3Path: string = path.join(testProjectPaths.testProject, 'node3.md')
    expect(graph.nodes[node3Path]).toBeDefined()
    expect(graph.nodes[node3Path].absoluteFilePathIsID).toBe(node3Path)
  })

  it('should extract title from heading when not in frontmatter', async () => {
    const r5: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r5)) throw new Error('Expected Right')
    const graph: Graph = r5.right

    expect(graph.nodes[path.join(testProjectPaths.testProject, 'node3.md')].contentWithoutYamlOrLinks).toContain('# Node Three')
  })

  it('should build outgoingEdges from wikilinks', async () => {
    const r6: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r6)) throw new Error('Expected Right')
    const graph: Graph = r6.right

    const node1Path: string = path.join(testProjectPaths.testProject, 'node1.md')
    const node2Path: string = path.join(testProjectPaths.testProject, 'node2.md')
    const node3Path: string = path.join(testProjectPaths.testProject, 'node3.md')
    expect(graph.nodes[node1Path].outgoingEdges).toEqual([{ targetId: node2Path, label: 'This is node one. It links to' }])
    expect(graph.nodes[node2Path].outgoingEdges.some((e: { targetId: string }) => e.targetId === node1Path)).toBe(true)
    expect(graph.nodes[node2Path].outgoingEdges.some((e: { targetId: string }) => e.targetId === node3Path)).toBe(true)
  })

  it('should handle nodes with no links', async () => {
    const r7: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r7)) throw new Error('Expected Right')
    const graph: Graph = r7.right

    expect(graph.nodes[path.join(testProjectPaths.testProject, 'node3.md')].outgoingEdges).toEqual([])
  })

  it('should handle nested directory structure', async () => {
    const r8: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r8)) throw new Error('Expected Right')
    const graph: Graph = r8.right

    const nestedPath: string = path.join(testProjectPaths.testProject, 'subfolder/nested.md')
    expect(graph.nodes[nestedPath]).toBeDefined()
    expect(graph.nodes[nestedPath].contentWithoutYamlOrLinks).toContain('# Nested')
  })

  it('should derive title from Markdown heading (single source of truth)', async () => {
    const r9: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r9)) throw new Error('Expected Right')
    const graph: Graph = r9.right

    const node1: GraphNode = graph.nodes[path.join(testProjectPaths.testProject, 'node1.md')]
    // Node1 has BOTH frontmatter title "Node One" AND heading "# Node One Content"
    // Markdown is the single source of truth - title comes from heading via getNodeTitle
    expect(getNodeTitle(node1)).toBe('Node One Content')
    expect(getNodeTitle(node1)).not.toBe('Node One') // YAML title is ignored
  })

  it('should be a pure IO function (same input -> same IO)', async () => {
    const r10: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r10)) throw new Error('Expected Right')
    const graph1: Graph = r10.right
    const r11: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([testProjectPaths.testProject])
    if (E.isLeft(r11)) throw new Error('Expected Right')
    const graph2: Graph = r11.right

    expect(Object.keys(graph1.nodes).sort()).toEqual(Object.keys(graph2.nodes).sort())
  })
})

describe('loadProjectPathAdditively', () => {
  let tmpDir: string
  let watchedDir: string
  let primaryProjectPath: string
  let secondaryProjectPath: string

  beforeAll(async () => {
    // Create temp directory structure:
    // tmpDir/
    //   project/           <- watchedDir
    //     primary-project/   <- primaryProjectPath (existing nodes)
    //       existing.md
    //     secondary-project/ <- secondaryProjectPath (new nodes to add)
    //       newfile1.md
    //       newfile2.md
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'additive-test-'))
    watchedDir = path.join(tmpDir, 'project')
    primaryProjectPath = path.join(watchedDir, 'primary-project')
    secondaryProjectPath = path.join(watchedDir, 'secondary-project')

    await fs.mkdir(primaryProjectPath, { recursive: true })
    await fs.mkdir(secondaryProjectPath, { recursive: true })

    // Create existing node in primary project
    await fs.writeFile(
      path.join(primaryProjectPath, 'existing.md'),
      `# Existing Node

This is an existing node.`
    )

    // Create new nodes in secondary project
    await fs.writeFile(
      path.join(secondaryProjectPath, 'newfile1.md'),
      `# New File 1

Content for new file 1.`
    )
    await fs.writeFile(
      path.join(secondaryProjectPath, 'newfile2.md'),
      `# New File 2

Content for new file 2. Links to [[existing]].`
    )
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should merge new project nodes into existing graph', async () => {
    // GIVEN: Load initial graph from primary project
    const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([primaryProjectPath])
    if (E.isLeft(initialResult)) throw new Error('Expected Right')
    const existingGraph: Graph = initialResult.right

    // Node IDs are now absolute paths
    const existingNodePath: string = path.join(primaryProjectPath, 'existing.md')
    expect(Object.keys(existingGraph.nodes)).toHaveLength(1)
    expect(existingGraph.nodes[existingNodePath]).toBeDefined()

    // WHEN: Load secondary project additively
    const additiveResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
      await loadProjectPathAdditively(secondaryProjectPath, existingGraph)

    // THEN: Result should be Right with merged graph
    if (E.isLeft(additiveResult)) throw new Error('Expected Right')
    const { graph: mergedGraph, delta } = additiveResult.right

    // THEN: Merged graph should contain all nodes (original + new)
    const newFile1Path: string = path.join(secondaryProjectPath, 'newfile1.md')
    const newFile2Path: string = path.join(secondaryProjectPath, 'newfile2.md')
    expect(Object.keys(mergedGraph.nodes)).toHaveLength(3)
    expect(mergedGraph.nodes[existingNodePath]).toBeDefined()
    expect(mergedGraph.nodes[newFile1Path]).toBeDefined()
    expect(mergedGraph.nodes[newFile2Path]).toBeDefined()

    // THEN: Delta should only contain the new nodes
    expect(delta).toHaveLength(2)
    const deltaNodeIds: readonly string[] = delta.map(d => d.type === 'UpsertNode' ? d.nodeToUpsert.absoluteFilePathIsID : '')
    expect(deltaNodeIds).toContain(newFile1Path)
    expect(deltaNodeIds).toContain(newFile2Path)
    expect(deltaNodeIds).not.toContain(existingNodePath)
  })

  it('should preserve existing node positions when merging', async () => {
    // GIVEN: Load initial graph and set a position on existing node
    const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([primaryProjectPath])
    if (E.isLeft(initialResult)) throw new Error('Expected Right')

    // Node IDs are now absolute paths
    const existingNodePath: string = path.join(primaryProjectPath, 'existing.md')
    const existingGraph: Graph = createGraph({
      ...initialResult.right.nodes,
      [existingNodePath]: {
        ...initialResult.right.nodes[existingNodePath],
        nodeUIMetadata: {
          ...initialResult.right.nodes[existingNodePath].nodeUIMetadata,
          position: O.some({ x: 100, y: 200 })
        }
      }
    })

    // WHEN: Load secondary project additively
    const additiveResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
      await loadProjectPathAdditively(secondaryProjectPath, existingGraph)

    if (E.isLeft(additiveResult)) throw new Error('Expected Right')
    const { graph: mergedGraph } = additiveResult.right

    // THEN: Existing node position should be preserved
    const existingNode: GraphNode = mergedGraph.nodes[existingNodePath]
    expect(O.isSome(existingNode.nodeUIMetadata.position)).toBe(true)
    if (O.isSome(existingNode.nodeUIMetadata.position)) {
      expect(existingNode.nodeUIMetadata.position.value).toEqual({ x: 100, y: 200 })
    }
  })

  it('should return empty delta when adding empty project', async () => {
    // GIVEN: Existing graph with nodes
    const initialResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([primaryProjectPath])
    if (E.isLeft(initialResult)) throw new Error('Expected Right')
    const existingGraph: Graph = initialResult.right

    // AND: Create an empty project
    const emptyProjectPath: string = path.join(watchedDir, 'empty-project')
    await fs.mkdir(emptyProjectPath, { recursive: true })

    // WHEN: Load empty project additively
    const additiveResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
      await loadProjectPathAdditively(emptyProjectPath, existingGraph)

    if (E.isLeft(additiveResult)) throw new Error('Expected Right')
    const { graph: mergedGraph, delta } = additiveResult.right

    // THEN: Graph should be unchanged
    expect(Object.keys(mergedGraph.nodes)).toHaveLength(1)

    // THEN: Delta should be empty
    expect(delta).toHaveLength(0)
  })
})
