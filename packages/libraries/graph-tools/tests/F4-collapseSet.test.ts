import { describe, expect, it } from 'vitest'
import {
  applyCommandWithDelta,
  loadSnapshot,
  project,
  type EdgeElement,
  type NodeElement,
} from '@vt/graph-state'

import {
  applyDeltaToStateCaptureOverlay,
  buildCapturedSerializedState,
  createStateCaptureOverlay,
} from '../src/commands/capture/run'
import { deriveFlowRuntimeContext, loadFlowDefinition, resolveFlowDefinition } from '../src/debug/flow/flows/index'
import type { CyDump } from '../src/debug/state/cyStateShape'

function renderProjectedElements(): CyDump
function renderProjectedElements(elements: readonly (NodeElement | EdgeElement)[]): CyDump
function renderProjectedElements(elements: readonly (NodeElement | EdgeElement)[] = []): CyDump {
  const nodes = elements.filter((element): element is NodeElement => !('source' in element))
  const edges = elements.filter((element): element is EdgeElement => 'source' in element)

  return {
    nodes: nodes.map(node => ({
      id: node.id,
      classes: [...(node.classes ?? [])],
      data: {
        ...node.data,
        id: node.id,
        ...(node.label !== undefined ? { label: node.label } : {}),
        ...(node.parent !== undefined ? { parent: node.parent } : {}),
      },
      position: node.position ?? { x: 0, y: 0 },
      visible: true,
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      classes: [...(edge.classes ?? [])],
    })),
    viewport: {
      zoom: 1,
      pan: { x: 0, y: 0 },
    },
    selection: [],
  }
}

describe('F4 collapseSet capture', () => {
  it('captures the collapsed folder in step state snapshots after the first F4 dispatch', async () => {
    const initialState = loadSnapshot('010-flat-folder')
    const definition = await loadFlowDefinition('F4')
    const resolved = resolveFlowDefinition(definition, deriveFlowRuntimeContext(initialState))
    const firstStep = resolved.steps[0]

    expect(firstStep).toEqual({
      dispatch: {
        type: 'SetFolderState',
        viewId: 'main',
        path: '/tmp/graph-state-fixtures/root-a/tasks',
        state: 'collapsed',
      },
    })

    if (!('dispatch' in firstStep)) {
      throw new Error('expected F4 step 1 to dispatch SetFolderState')
    }

    const overlayBeforeStep = createStateCaptureOverlay(initialState)
    const collapseResult = applyCommandWithDelta(initialState, firstStep.dispatch)
    const rendered = renderProjectedElements([
      ...project(collapseResult.state).nodes,
      ...project(collapseResult.state).edges,
    ])
    const captured = buildCapturedSerializedState(
      initialState,
      applyDeltaToStateCaptureOverlay(overlayBeforeStep, collapseResult.delta),
      rendered,
    )

    const folderId = `${firstStep.dispatch.path}/`
    expect(collapseResult.state.collapseSet.has(folderId)).toBe(true)
    expect(rendered.nodes.some(node => node.id === folderId)).toBe(true)
    expect(captured.collapseSet).toEqual([folderId])
  })
})
