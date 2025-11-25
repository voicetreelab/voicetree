import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { loadGraphFromDisk } from '@/shell/edge/main/graph/readAndDBEventsPath/loadGraphFromDisk.ts'

describe('loadGraphFromDisk', () => {
  const testVaultPaths = {
    testVault: '',
    emptyVault: ''
  }

  beforeAll(async () => {
    // Create temp directory for test vault
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-test-'))
    testVaultPaths.testVault = path.join(tmpDir, 'test-vault')
    testVaultPaths.emptyVault = path.join(tmpDir, 'empty-vault')
    const testVaultPath = testVaultPaths.testVault
    const emptyVaultPath = testVaultPaths.emptyVault

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
    const r1 = await loadGraphFromDisk(O.some(testVaultPaths.emptyVault))
    if (E.isLeft(r1)) throw new Error('Expected Right')
    const graph = r1.right

    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  it('should load all nodes from vault', async () => {
    const r2 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r2)) throw new Error('Expected Right')
    const graph = r2.right

    expect(Object.keys(graph.nodes)).toHaveLength(4)
    expect(graph.nodes['node1.md']).toBeDefined()
    expect(graph.nodes['node2.md']).toBeDefined()
    expect(graph.nodes['node3.md']).toBeDefined()
    expect(graph.nodes['subfolder/nested.md']).toBeDefined()
  })

  it('should parse node properties from frontmatter', async () => {
    const r3 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r3)) throw new Error('Expected Right')
    const graph = r3.right

    const node1 = graph.nodes['node1.md']
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
    const r4 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r4)) throw new Error('Expected Right')
    const graph = r4.right

    expect(graph.nodes['node3.md']).toBeDefined()
    expect(graph.nodes['node3.md'].relativeFilePathIsID).toBe('node3.md')
  })

  it('should extract title from heading when not in frontmatter', async () => {
    const r5 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r5)) throw new Error('Expected Right')
    const graph = r5.right

    expect(graph.nodes['node3.md'].contentWithoutYamlOrLinks).toContain('# Node Three')
  })

  it('should build outgoingEdges from wikilinks', async () => {
    const r6 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r6)) throw new Error('Expected Right')
    const graph = r6.right

    expect(graph.nodes['node1.md'].outgoingEdges).toEqual([{ targetId: 'node2.md', label: 'This is node one. It links to' }])
    expect(graph.nodes['node2.md'].outgoingEdges.some((e: { targetId: string }) => e.targetId === 'node1.md')).toBe(true)
    expect(graph.nodes['node2.md'].outgoingEdges.some((e: { targetId: string }) => e.targetId === 'node3.md')).toBe(true)
  })

  it('should handle nodes with no links', async () => {
    const r7 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r7)) throw new Error('Expected Right')
    const graph = r7.right

    expect(graph.nodes['node3.md'].outgoingEdges).toEqual([])
  })

  it('should handle nested directory structure', async () => {
    const r8 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r8)) throw new Error('Expected Right')
    const graph = r8.right

    expect(graph.nodes['subfolder/nested.md']).toBeDefined()
    expect(graph.nodes['subfolder/nested.md'].contentWithoutYamlOrLinks).toContain('# Nested')
  })

  it('should prioritize frontmatter title over heading title', async () => {
    const r9 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r9)) throw new Error('Expected Right')
    const graph = r9.right

    const node1 = graph.nodes['node1.md']
    // Node1 has BOTH frontmatter title "Node One" AND heading "# Node One Content"
    // The title should come from frontmatter, not the heading
    expect(node1.nodeUIMetadata.title).toBe('Node One')
    expect(node1.nodeUIMetadata.title).not.toBe('Node One Content')
  })

  it('should be a pure IO function (same input -> same IO)', async () => {
    const r10 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r10)) throw new Error('Expected Right')
    const graph1 = r10.right
    const r11 = await loadGraphFromDisk(O.some(testVaultPaths.testVault))
    if (E.isLeft(r11)) throw new Error('Expected Right')
    const graph2 = r11.right

    expect(Object.keys(graph1.nodes).sort()).toEqual(Object.keys(graph2.nodes).sort())
  })
})
