import { describe, expect, it } from 'vitest'

import {
  composeMarkdownFileContent,
  resolveFolderMarkdownTarget,
} from './writeMarkdownFile.ts'

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
