import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import { loadGraphFromDisk } from '@/functional/shell/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'

describe('loadGraphFromDisk', () => {
  let testVaultPath: string
  let emptyVaultPath: string

  beforeAll(async () => {
    // Create temp directory for test vault
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'))
    testVaultPath = path.join(tmpDir, 'test-vault')
    emptyVaultPath = path.join(tmpDir, 'empty-vault')

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

This is node one. It links to [[Node Two]].`
    )

    await fs.writeFile(
      path.join(testVaultPath, 'node2.md'),
      `---
node_id: "2"
title: "Node Two"
summary: "Second node"
---
# Node Two Content

This is node two. It links to [[Node One]] and [[Node Three]].`
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
    await fs.rm(path.dirname(testVaultPath), { recursive: true, force: true })
  })

  it('should load empty graph from empty directory', async () => {
    const graph = await loadGraphFromDisk(O.some(emptyVaultPath))

    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  it('should load all nodes from vault', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(Object.keys(graph.nodes)).toHaveLength(4)
    expect(graph.nodes['1']).toBeDefined()
    expect(graph.nodes['2']).toBeDefined()
    expect(graph.nodes['node3']).toBeDefined()
    expect(graph.nodes['nested']).toBeDefined()
  })

  it('should parse node properties from frontmatter', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    const node1 = graph.nodes['1']
    expect(node1.content).toContain('title: "Node One"')
    expect(node1.content).toContain('summary: "First node"')
    expect(O.isSome(node1.nodeUIMetadata.color)).toBe(true)
    if (O.isSome(node1.nodeUIMetadata.color)) {
      expect(node1.nodeUIMetadata.color.value).toBe('#FF0000')
    }
  })

  it('should use filename as node_id when missing from frontmatter', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(graph.nodes['node3.md']).toBeDefined()
    expect(graph.nodes['node3.md'].relativeFilePathIsID).toBe('node3.md')
  })

  it('should extract title from heading when not in frontmatter', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(graph.nodes['node3.md'].content).toContain('# Node Three')
  })

  it('should build outgoingEdges from wikilinks', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(graph.nodes['1'].outgoingEdges).toEqual(['2'])
    expect(graph.nodes['2'].outgoingEdges).toContain('1')
    expect(graph.nodes['2'].outgoingEdges).toContain('node3.md')
  })

  it('should handle nodes with no links', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(graph.nodes['node3.md'].outgoingEdges).toEqual([])
  })

  it('should handle nested directory structure', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(graph.nodes['nested']).toBeDefined()
    expect(graph.nodes['nested'].content).toContain('# Nested')
  })

  it('should preserve full content including frontmatter', async () => {
    const graph = await loadGraphFromDisk(O.some(testVaultPath))

    expect(graph.nodes['1'].content).toContain('node_id: "1"')
    expect(graph.nodes['1'].content).toContain('This is node one')
  })

  it('should be a pure IO function (same input -> same IO)', async () => {
    const graph1 = await loadGraphFromDisk(O.some(testVaultPath))
    const graph2 = await loadGraphFromDisk(O.some(testVaultPath))

    expect(Object.keys(graph1.nodes).sort()).toEqual(Object.keys(graph2.nodes).sort())
  })
})
