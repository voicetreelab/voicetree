import { describe, expect, it } from 'vitest'

import {
  deriveFlowRuntimeContext,
  loadAllFlowDefinitions,
  loadFlowDefinition,
  resolveFlowDefinition,
  type FlowDefinition,
} from '../src/debug/flows/index'

describe('flow library', () => {
  it('loads all ten authored golden flows', async () => {
    const flows = await loadAllFlowDefinitions()

    expect(flows.map(flow => flow.flow)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'])
    expect(flows.every(flow => flow.steps.length > 0)).toBe(true)
  })

  it('loads the authored F10 add-child regression flow with validated steps', async () => {
    const flow = await loadFlowDefinition('F10')

    expect(flow).toMatchObject({
      flow: 'F10',
      title: 'Click Add Child on tapped node creates + auto-pins visible child',
      steps: [
        { dispatch: { type: 'RequestFit', paddingPx: 80 } },
        { wait: 300 },
        { tapNode: '{{primaryNodeId}}' },
        { wait: 400 },
        { click: "[id='window-{{primaryNodeId}}-editor'] button[title='Add Child']" },
        { wait: 1500 },
      ],
    })
  })

  it('derives a deterministic runtime context from live state', () => {
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

    expect(deriveFlowRuntimeContext(state as never)).toEqual({
      rootPath: '/tmp/vault',
      primaryNodeId: '/tmp/vault/a.md',
      secondaryNodeId: '/tmp/vault/b.md',
      primaryFolderId: '/tmp/vault/notes/',
    })
  })

  it('replaces placeholders in step specs before the runner writes them', () => {
    const flow = {
      flow: 'F5',
      title: 'Selection toggle',
      intent: 'toggle between two ids',
      exercises: ['selection'],
      likelyStatusToday: 'drift risk',
      judgeFocus: ['selection snapshots'],
      steps: [
        { tapNode: '{{primaryNodeId}}' },
        { dispatch: { type: 'Select', ids: ['{{primaryNodeId}}'] } },
        { dispatch: { type: 'Collapse', folder: '{{primaryFolderId}}' } },
        { dispatch: { type: 'LoadRoot', root: '{{rootPath}}' } },
      ],
    } satisfies FlowDefinition

    const resolved = resolveFlowDefinition(flow, {
      rootPath: '/tmp/vault',
      primaryNodeId: '/tmp/vault/a.md',
      secondaryNodeId: '/tmp/vault/b.md',
      primaryFolderId: '/tmp/vault/notes/',
    })

    expect(resolved.steps).toEqual([
      { tapNode: '/tmp/vault/a.md' },
      { dispatch: { type: 'Select', ids: ['/tmp/vault/a.md'] } },
      { dispatch: { type: 'Collapse', folder: '/tmp/vault/notes/' } },
      { dispatch: { type: 'LoadRoot', root: '/tmp/vault' } },
    ])
  })
})
