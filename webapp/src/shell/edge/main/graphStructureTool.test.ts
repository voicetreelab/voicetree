import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { graphStructureTool } from '@/shell/edge/main/mcp-server/graphStructureTool'
import type { McpToolResponse } from '@/shell/edge/main/mcp-server/types'
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

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir, withSummaries: false })
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

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir, withSummaries: false })
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

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir, withSummaries: false })
    const result: { success: boolean; nodeCount: number; orphanCount: number; ascii: string } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBe(3)
    expect(result.orphanCount).toBeGreaterThanOrEqual(2)
    expect(result.ascii).toContain('Island A')
    expect(result.ascii).toContain('Island B')
    expect(result.ascii).toContain('Island C')
  })

  it('auto-enables context-style output for small folders when withSummaries is omitted', async () => {
    writeFileSync(path.join(tempDir, 'root.md'), '# Root\nFirst detail\nSecond detail\n[[child]]\n')
    writeFileSync(path.join(tempDir, 'child.md'), '# Child\nOnly child detail\n')

    const response: McpToolResponse = await graphStructureTool({ folderPath: tempDir })
    const result: { success: boolean; nodeCount: number; ascii: string } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.nodeCount).toBe(2)
    expect(result.ascii).toContain('## Node Contents')
    expect(result.ascii).toContain('- **Root**')
  })

  it('passes through withSummaries to the shared graph-structure implementation', async () => {
    const rootPath = path.join(tempDir, 'root.md')
    const childPath = path.join(tempDir, 'child.md')
    writeFileSync(path.join(tempDir, 'root.md'), [
      '---',
      'status: claimed',
      '---',
      '# Root',
      '',
      'First detail',
      'Second detail',
      'Third detail',
      '',
      '[[child]]',
      ''
    ].join('\n'))
    writeFileSync(path.join(tempDir, 'child.md'), [
      '# Child',
      '',
      'Only child detail',
      ''
    ].join('\n'))

    const response: McpToolResponse = await graphStructureTool({
      folderPath: tempDir,
      withSummaries: true
    })
    const result: { success: boolean; ascii: string } =
      JSON.parse(response.content[0].text)

    expect(result.success).toBe(true)
    expect(result.ascii).toBe([
      'Tree structure:',
      'Root',
      '└── Child',
      '',
      '## Node Contents',
      `- **Root** (${rootPath})`,
      '  First detail',
      '  Second detail',
      '  Third detail',
      '  ...1 additional lines',
      `- **Child** (${childPath})`,
      '  Only child detail'
    ].join('\n'))
  })
})
