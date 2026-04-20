import cytoscape, { type ElementDefinition } from 'cytoscape'
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
} from '../src/commands/run'
import { deriveFlowRuntimeContext, loadFlowDefinition, resolveFlowDefinition } from '../src/debug/flows/index'
import type { CyDump } from '../src/debug/cyStateShape'

function toCyElement(element: NodeElement | EdgeElement): ElementDefinition {
  if ('source' in element) {
    return {
      group: 'edges',
      data: {
        ...(element.data ?? {}),
        id: element.id,
        source: element.source,
        target: element.target,
        kind: element.kind,
        ...(element.label !== undefined ? { label: element.label } : {}),
      },
      ...(element.classes ? { classes: [...element.classes] } : {}),
    }
  }

  return {
    group: 'nodes',
    data: {
      ...(element.data ?? {}),
      id: element.id,
      kind: element.kind,
      ...(element.parent !== undefined ? { parent: element.parent } : {}),
      ...(element.label !== undefined ? { label: element.label } : {}),
    },
    ...(element.position ? { position: element.position } : {}),
    ...(element.classes ? { classes: [...element.classes] } : {}),
  }
}

function renderThroughCytoscape(): CyDump
function renderThroughCytoscape(elements: readonly (NodeElement | EdgeElement)[]): CyDump
function renderThroughCytoscape(elements: readonly (NodeElement | EdgeElement)[] = []): CyDump {
  const cy = cytoscape({
    headless: true,
    styleEnabled: false,
    elements: elements.map(toCyElement),
  })

  try {
    return {
      nodes: cy.nodes().map(node => ({
        id: node.id(),
        classes: node.classes(),
        position: node.position(),
        visible: true,
      })),
      edges: cy.edges().map(edge => ({
        id: edge.id(),
        source: edge.source().id(),
        target: edge.target().id(),
        classes: edge.classes(),
      })),
      viewport: {
        zoom: cy.zoom(),
        pan: cy.pan(),
      },
      selection: cy.$(':selected').map(node => node.id()).sort((left, right) => left.localeCompare(right)),
    }
  } finally {
    cy.destroy()
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
        type: 'Collapse',
        folder: '/tmp/graph-state-fixtures/root-a/tasks/',
      },
    })

    if (!('dispatch' in firstStep)) {
      throw new Error('expected F4 step 1 to dispatch Collapse')
    }

    const overlayBeforeStep = createStateCaptureOverlay(initialState)
    const collapseResult = applyCommandWithDelta(initialState, firstStep.dispatch)
    const rendered = renderThroughCytoscape([
      ...project(collapseResult.state).nodes,
      ...project(collapseResult.state).edges,
    ])
    const captured = buildCapturedSerializedState(
      initialState,
      applyDeltaToStateCaptureOverlay(overlayBeforeStep, collapseResult.delta),
      rendered,
    )

    expect(collapseResult.state.collapseSet.has(firstStep.dispatch.folder)).toBe(true)
    expect(rendered.nodes.some(node => node.id === firstStep.dispatch.folder)).toBe(true)
    expect(captured.collapseSet).toEqual([firstStep.dispatch.folder])
  })
})
