import { describe, expect, it } from 'vitest'

import {
  deriveFlowRuntimeContext,
  loadAllFlowDefinitions,
  loadFlowDefinition,
  resolveFlowDefinition,
  type FlowDefinition,
} from '../../src/debug/flow/flows/index'

describe('flow library', () => {
  it('loads all authored golden flows', async () => {
    const flows = await loadAllFlowDefinitions()

    expect(flows.map(flow => flow.flow)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F9', 'F10'])
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
          '/tmp/project/a.md': {},
          '/tmp/project/b.md': {},
        },
      },
      roots: {
        loaded: new Set(['/tmp/project']),
        folderTree: [
          {
            name: 'project',
            absolutePath: '/tmp/project',
            loadState: 'loaded',
            isWriteTarget: true,
            children: [
              {
                name: 'notes',
                absolutePath: '/tmp/project/notes',
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
      rootPath: '/tmp/project',
      primaryNodeId: '/tmp/project/a.md',
      secondaryNodeId: '/tmp/project/b.md',
      primaryFolderId: '/tmp/project/notes/',
      primaryFolderPath: '/tmp/project/notes',
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
        { dispatch: { type: 'SetFolderState', viewId: 'main', path: '{{primaryFolderPath}}', state: 'collapsed' } },
      ],
    } satisfies FlowDefinition

    const resolved = resolveFlowDefinition(flow, {
      rootPath: '/tmp/project',
      primaryNodeId: '/tmp/project/a.md',
      secondaryNodeId: '/tmp/project/b.md',
      primaryFolderId: '/tmp/project/notes/',
      primaryFolderPath: '/tmp/project/notes',
    })

    expect(resolved.steps).toEqual([
      { tapNode: '/tmp/project/a.md' },
      { dispatch: { type: 'Select', ids: ['/tmp/project/a.md'] } },
      { dispatch: { type: 'SetFolderState', viewId: 'main', path: '/tmp/project/notes', state: 'collapsed' } },
    ])
  })
})
