import { describe, expect, it, vi } from 'vitest'

import type { CyDump, CyDumpNode } from '../src/debug/state/cyStateShape'
import { folderAspect } from '../src/commands/folders/folderAspect'
import { computeFolderAspects } from '../src/view/folderAspect'

function makeFolderNode(id = 'folder-1', folderLabel = 'Folder 1'): CyDumpNode {
  return {
    id,
    classes: ['folder'],
    data: {
      id,
      folderLabel,
      isFolderNode: true,
      collapsed: false,
    },
    position: { x: 0, y: 0 },
    visible: true,
    width: 320,
    height: 240,
  }
}

function makeChildNode(
  id: string,
  x: number,
  y: number,
  parent = 'folder-1',
): CyDumpNode {
  return {
    id,
    classes: ['file'],
    data: {
      id,
      label: id,
      parent,
    },
    position: { x, y },
    visible: true,
    width: 120,
    height: 80,
  }
}

function makeDump(nodes: readonly CyDumpNode[]): CyDump {
  return {
    nodes: [...nodes],
    edges: [],
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    selection: [],
  }
}

function makeHealthyDump(): CyDump {
  const folder = makeFolderNode()
  const children = [
    makeChildNode('child-1', -120, -120),
    makeChildNode('child-2', 0, -120),
    makeChildNode('child-3', 120, -120),
    makeChildNode('child-4', -120, 0),
    makeChildNode('child-5', 0, 0),
    makeChildNode('child-6', 120, 0),
    makeChildNode('child-7', 0, 120),
  ]
  return makeDump([folder, ...children])
}

function makePathologicalDump(): CyDump {
  const folder = makeFolderNode()
  const children = Array.from({ length: 7 }, (_, index) =>
    makeChildNode(`child-${index + 1}`, 0, index * 200),
  )
  return makeDump([folder, ...children])
}

describe('computeFolderAspects', () => {
  it('reports an empty dump as having no folders checked and no violations', () => {
    expect(computeFolderAspects(makeDump([]))).toEqual({
      threshold: 3,
      foldersChecked: 0,
      violations: [],
      worstViolation: null,
    })
  })

  it('does not flag a healthy expanded folder whose children occupy a balanced 2D bbox', () => {
    const report = computeFolderAspects(makeHealthyDump())

    expect(report.foldersChecked).toBe(1)
    expect(report.violations).toHaveLength(0)
    expect(report.worstViolation).toBeNull()
  })

  it('flags a pathological tall-chain folder and exposes the worst violation', () => {
    const report = computeFolderAspects(makePathologicalDump())

    expect(report.foldersChecked).toBe(1)
    expect(report.violations).toHaveLength(1)
    expect(report.worstViolation).toMatchObject({
      folderId: 'folder-1',
      label: 'Folder 1',
      childCount: 7,
    })
    expect(report.worstViolation?.aspectRatio).toBeGreaterThan(3)
  })

  it('skips folders below the default minChildCount of 3', () => {
    const report = computeFolderAspects(makeDump([
      makeFolderNode(),
      makeChildNode('child-1', 0, 0),
      makeChildNode('child-2', 100, 0),
    ]))

    expect(report.foldersChecked).toBe(0)
    expect(report.violations).toHaveLength(0)
    expect(report.worstViolation).toBeNull()
  })
})

describe('folder-aspect command', () => {
  it('returns the computed report from a stubbed rendered cy dump', async () => {
    const page = {
      evaluate: vi.fn(async () => makePathologicalDump()),
    }

    const result = await folderAspect(page)

    expect(page.evaluate).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: true,
      command: 'folder-aspect',
    })
    if (!result.ok) {
      throw new Error(`expected ok response, got: ${result.error}`)
    }
    expect(result.result.violations).toHaveLength(1)
    expect(result.result.worstViolation?.folderId).toBe('folder-1')
  })
})
