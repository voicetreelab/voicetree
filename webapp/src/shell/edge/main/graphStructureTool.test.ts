import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { graphStructureTool } from '@/shell/edge/main/mcp-server/graphStructureTool'
import type { McpToolResponse } from '@/shell/edge/main/mcp-server/types'
import { EXAMPLE_SMALL_PATH } from '@/utils/test-utils/fixture-paths'

let tempDir: string = ''

describe('graphStructureTool', () => {

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'graph-structure-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true })
  })

  it('known tree structure — 4 files forming root with children and grandchild', async () => {
    writeFileSync(path.join(tempDir, 'root.md'), '# Root\n[[child-a]]\n[[child-b]]')
    writeFileSync(path.join(tempDir, 'child-a.md'), '# Child A\n[[grandchild]]')
    writeFileSync(path.join(tempDir, 'child-b.md'), '# Child B')
    writeFileSync(path.join(tempDir, 'grandchild.md'), '# Grandchild')

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir })
    const result: { success: boolean; nodeCount: number; ascii: string; orphanCount: number } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBe(4)

    const expectedAscii: string = `Root
├── Child A
│   └── Grandchild
└── Child B`
    expect(result.ascii).toBe(expectedAscii)
  })

  it('empty folder — returns nodeCount 0', async () => {
    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir })
    const result: { success: boolean; nodeCount: number } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBe(0)
  })

  it('ctx-nodes/ subfolder excluded from graph', async () => {
    writeFileSync(path.join(tempDir, 'visible.md'), '# Visible Node')
    mkdirSync(path.join(tempDir, 'ctx-nodes'))
    writeFileSync(path.join(tempDir, 'ctx-nodes', 'hidden.md'), '# Hidden Context Node')

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir })
    const result: { success: boolean; nodeCount: number; ascii: string } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBe(1)
    expect(result.ascii).toContain('Visible Node')
    expect(result.ascii).not.toContain('Hidden Context Node')
  })

  it('orphan nodes — disconnected files reported in orphanCount', async () => {
    writeFileSync(path.join(tempDir, 'island-a.md'), '# Island A')
    writeFileSync(path.join(tempDir, 'island-b.md'), '# Island B')
    writeFileSync(path.join(tempDir, 'island-c.md'), '# Island C')

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir })
    const result: { success: boolean; nodeCount: number; orphanCount: number; ascii: string } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBe(3)
    expect(result.orphanCount).toBeGreaterThanOrEqual(2)
    expect(result.ascii).toContain('Island A')
    expect(result.ascii).toContain('Island B')
    expect(result.ascii).toContain('Island C')
  })

  it('real fixture test — example_small returns non-empty graph', async () => {
    const response: McpToolResponse = await graphStructureTool({ folderPath: EXAMPLE_SMALL_PATH })
    const result: { success: boolean; nodeCount: number; ascii: string } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBeGreaterThan(0)
    expect(result.ascii.length).toBeGreaterThan(0)
  })
})
