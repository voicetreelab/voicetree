import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyGraph } from '@vt/graph-model'
import { mapFSEventsToGraphDelta } from '@vt/graph-model/graph'

import {
  composeMarkdownFileContent,
  resolveFolderMarkdownTarget,
  writeMarkdownFile,
} from './writeMarkdownFile.ts'
import * as applyGraphDeltaModule from './applyGraphDelta.ts'
import { getGraph, setGraph } from '@vt/graph-db-server/state/graph-store'
import { clearRecentDeltas, isOurRecentDelta } from '@vt/graph-db-server/state/recent-deltas-store'

describe('composeMarkdownFileContent', () => {
  it('preserves an existing frontmatter block verbatim', () => {
    const existing = [
      '---',
      'position: {x:1,y:2}',
      '# comment-like yaml value stays raw',
      '---',
      '# Old body',
    ].join('\n')

    expect(composeMarkdownFileContent(existing, '# New body')).toBe([
      '---',
      'position: {x:1,y:2}',
      '# comment-like yaml value stays raw',
      '---',
      '# New body',
    ].join('\n'))
  })

  it('does not copy blank lines between frontmatter and old body', () => {
    const existing = '---\ntitle: Old\n---\n\n\n# Old body\n'

    expect(composeMarkdownFileContent(existing, '# New body\n')).toBe(
      '---\ntitle: Old\n---\n# New body\n',
    )
  })

  it('returns new body for files without frontmatter', () => {
    expect(composeMarkdownFileContent('# Old body\n', '# New body\n')).toBe('# New body\n')
  })

  it('returns new body for missing files', () => {
    expect(composeMarkdownFileContent(null, '# New body\n')).toBe('# New body\n')
  })
})

describe('resolveFolderMarkdownTarget', () => {
  it('maps folder node paths to index.md', () => {
    expect(resolveFolderMarkdownTarget('/vault/folder/')).toBe('/vault/folder/index.md')
  })
})

describe('writeMarkdownFile', () => {
  beforeEach(() => {
    setGraph(createEmptyGraph())
    clearRecentDeltas()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setGraph(createEmptyGraph())
    clearRecentDeltas()
  })

  it('leaves chokidar free to recover when in-memory apply fails after the disk write', async () => {
    const targetPath = '/vault/recoverable.md'
    const body = '# Recoverable\n\nBody.\n'
    const writes: string[] = []

    vi.spyOn(applyGraphDeltaModule, 'applyGraphDeltaToMemState')
      .mockRejectedValueOnce(new Error('apply failed'))

    await expect(writeMarkdownFile({
      absolutePath: targetPath,
      body,
      editorId: 'editor-1',
    }, {
      readFile: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
      writeFile: async (_filePath, content) => {
        writes.push(content)
      },
    })).rejects.toThrow('apply failed')

    expect(writes).toEqual([body])

    const chokidarDelta = mapFSEventsToGraphDelta({
      absolutePath: targetPath,
      content: body,
      eventType: 'Added',
    }, getGraph())
    expect(isOurRecentDelta(chokidarDelta)).toBe(false)
  })
})
