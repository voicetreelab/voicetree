import { describe, expect, it } from 'vitest'

import {
  RECORDED_STATE_FIXTURE_IDS,
  deriveStressRuntimeContext,
  generateStressSequence,
  resolveStressSequence,
} from '../src/debug/stress/stressSpec'

describe('stressSpec', () => {
  it('pins the full recorded-state replay corpus', () => {
    expect(RECORDED_STATE_FIXTURE_IDS).toHaveLength(25)
    expect(RECORDED_STATE_FIXTURE_IDS[0]).toBe('001-empty')
    expect(RECORDED_STATE_FIXTURE_IDS.at(-1)).toBe('080-folder-nodes-real-vault')
  })

  it('generates deterministic randomized step sequences for a given seed', () => {
    const first = generateStressSequence(4, 19)
    const second = generateStressSequence(4, 19)
    const third = generateStressSequence(4, 20)

    expect(first).toEqual(second)
    expect(third).not.toEqual(first)
    expect(first.length).toBeGreaterThan(0)
  })

  it('derives and resolves live placeholders before the runner writes JSON', () => {
    const state = {
      graph: {
        nodes: {
          '/tmp/vault/a.md': {},
          '/tmp/vault/b.md': {},
        },
      },
      roots: {
        loaded: new Set(['/tmp/vault']),
        folderTree: [
          {
            name: 'vault',
            absolutePath: '/tmp/vault',
            loadState: 'loaded',
            isWriteTarget: true,
            children: [
              {
                name: 'notes',
                absolutePath: '/tmp/vault/notes',
                loadState: 'loaded',
                isWriteTarget: false,
                children: [],
              },
            ],
          },
        ],
      },
    } as const

    const resolved = resolveStressSequence(
      [
        { dispatch: { type: 'Collapse', folder: '{{primaryFolderId}}' } },
        { dispatch: { type: 'Select', ids: ['{{primaryNodeId}}'] } },
        { dispatch: { type: 'LoadRoot', root: '{{rootPath}}' } },
      ],
      deriveStressRuntimeContext(state as never),
    )

    expect(resolved).toEqual([
      { dispatch: { type: 'Collapse', folder: '/tmp/vault/notes/' } },
      { dispatch: { type: 'Select', ids: ['/tmp/vault/a.md'] } },
      { dispatch: { type: 'LoadRoot', root: '/tmp/vault' } },
    ])
  })
})
