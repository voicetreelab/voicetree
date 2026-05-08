import { describe, expect, it } from 'vitest'

import { classifyDriftReport, createDivergenceClassBaseline } from '../src/debug/stress/divergenceClass'

describe('divergenceClass', () => {
  it('maps drift report shapes to stable class ids', () => {
    const classIds = classifyDriftReport({
      dataVsProjection: {
        equal: false,
        missingInA: ['edge:a->b'],
        missingInB: ['/tmp/vault/node.md'],
        differing: [
          { id: '/tmp/vault/node.md', fields: ['classes', 'position'] },
          { id: '__selection__', fields: ['items'] },
        ],
      },
      projectionVsRendered: {
        equal: false,
        missingInA: ['/tmp/vault/other.md'],
        missingInB: ['edge:b->c'],
        differing: [
          { id: '__viewport__', fields: ['pan'] },
          { id: 'edge:b->c', fields: ['classes'] },
        ],
      },
      nodeContentStale: [
        { id: '/tmp/vault/node.md', mainLen: 10, fsLen: 8 },
        { id: '/tmp/vault/missing.md', mainLen: 7, fsLen: -1 },
      ],
    })

    expect(classIds).toEqual([
      'dataVsProjection.edges.extra-in-projection',
      'dataVsProjection.layout.node-pos-delta',
      'dataVsProjection.nodes.classes.mismatch',
      'dataVsProjection.nodes.missing-in-projection',
      'dataVsProjection.selection.items.mismatch',
      'nodeContentStale.fs-missing',
      'nodeContentStale.length-mismatch',
      'projectionVsRendered.edges.classes.mismatch',
      'projectionVsRendered.edges.missing-in-rendered',
      'projectionVsRendered.layout.pan-delta',
      'projectionVsRendered.nodes.extra-in-rendered',
    ])
  })

  it('creates a sorted, deduplicated baseline document', () => {
    expect(createDivergenceClassBaseline([
      'b',
      'a',
      'b',
    ])).toEqual({
      $schema: 'vt-debug/divergence-class-baseline@1',
      description: 'Allowed divergence class ids for the W4-A drift soak harness baseline.',
      classIds: ['a', 'b'],
    })
  })
})
