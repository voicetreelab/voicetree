import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyGraph } from '@vt/graph-model'
import { mapFSEventsToGraphDelta } from '@vt/graph-model/graph'

import {
  composeMarkdownFileContent,
  preservePendingExternalAppend,
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
    expect(resolveFolderMarkdownTarget('/project/folder/')).toBe('/project/folder/index.md')
  })
})

describe('preservePendingExternalAppend', () => {
  it('preserves append-only disk content that has not reached graph state yet', () => {
    const graphBody = '# Typing Target\n\nInitial content that will be replaced.\n'
    const editorBody = 'user is typing this while the daemon is active'
    const externalSuffix = '\n\n## Agent Section\nagent wrote this\n'

    expect(
      preservePendingExternalAppend(`${graphBody}${externalSuffix}`, editorBody, graphBody),
    ).toBe(`${editorBody}${externalSuffix}`)
  })

  it('preserves append-only disk content against the previous editor body', () => {
    const graphBody = '# Typing Target\n\nInitial content that will be replaced.\n'
    const previousEditorBody = 'user is typing this'
    const nextEditorBody = 'user is typing this while the daemon is active'
    const externalSuffix = '\n\n## Agent Section\nagent wrote this\n'

    expect(
      preservePendingExternalAppend(
        `${previousEditorBody}${externalSuffix}`,
        nextEditorBody,
        graphBody,
        previousEditorBody,
      ),
    ).toBe(`${nextEditorBody}${externalSuffix}`)
  })

  it('allows a previously preserved append to be deleted after the editor has seen it', () => {
    const externalSuffix = '\n\n## Agent Section\nagent wrote this\n'
    const bodyWithSuffix = `user is typi${externalSuffix}`

    expect(
      preservePendingExternalAppend(
        bodyWithSuffix,
        'user is typi',
        bodyWithSuffix,
        bodyWithSuffix,
      ),
    ).toBe('user is typi')
  })

  it('stops carrying a pending external suffix after the editor includes it', () => {
    const externalSuffix = '\n\n## Agent Section\nagent wrote this\n'
    const editorBody = `user is typi${externalSuffix}`

    expect(
      preservePendingExternalAppend(
        editorBody,
        editorBody,
        editorBody,
        editorBody,
      ),
    ).toBe(editorBody)
  })

  it('does not preserve old disk content when there is no pending append', () => {
    const graphBody = '# Typing Target\n\nInitial content that will be replaced.\n'

    expect(
      preservePendingExternalAppend(graphBody, 'user replaced the whole document', graphBody),
    ).toBe('user replaced the whole document')
  })

  it('preserves frontmatter-bearing pending append by comparing only the markdown body', () => {
    const graphBody = '# Typing Target\n\nInitial content.\n'
    const externalSuffix = '\n\n## Agent Section\nagent wrote this\n'
    const existingContent = `---\nposition: {x:1,y:2}\n---\n${graphBody}${externalSuffix}`

    expect(
      preservePendingExternalAppend(existingContent, 'replacement body', graphBody),
    ).toBe(`replacement body${externalSuffix}`)
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
    const targetPath = '/project/recoverable.md'
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
