import { describe, expect, it } from 'vitest'

import { validateStepSpec } from '../src/debug/stepShape'

describe('validateStepSpec', () => {
  it('accepts the supported step variants', () => {
    expect(validateStepSpec({ click: '#toolbar button' })).toEqual({
      ok: true,
      step: { click: '#toolbar button' },
    })
    expect(validateStepSpec({ type: 'hello', selector: '#window-node-editor .cm-content' })).toEqual({
      ok: true,
      step: { type: 'hello', selector: '#window-node-editor .cm-content' },
    })
    expect(validateStepSpec({ press: 'Cmd+Enter' })).toEqual({
      ok: true,
      step: { press: 'Cmd+Enter' },
    })
    expect(validateStepSpec({ wait: 250 })).toEqual({
      ok: true,
      step: { wait: 250 },
    })
    expect(validateStepSpec({ waitFor: '#graph-root', timeoutMs: 1500 })).toEqual({
      ok: true,
      step: { waitFor: '#graph-root', timeoutMs: 1500 },
    })
    expect(validateStepSpec({ navigate: 'http://localhost:5173/' })).toEqual({
      ok: true,
      step: { navigate: 'http://localhost:5173/' },
    })
    expect(validateStepSpec({ dispatch: { type: 'Select', ids: ['node-a'] } })).toEqual({
      ok: true,
      step: { dispatch: { type: 'Select', ids: ['node-a'] } },
    })
  })

  it('rejects non-object steps and ambiguous tags', () => {
    expect(validateStepSpec('click')).toEqual({
      ok: false,
      error: 'step must be an object',
    })
    expect(validateStepSpec({ click: '#a', wait: 1 })).toEqual({
      ok: false,
      error: 'step must contain exactly one of: click, type, press, wait, waitFor, navigate, dispatch',
    })
  })

  it('rejects malformed field values and unexpected keys', () => {
    expect(validateStepSpec({ type: '', selector: '#editor' })).toEqual({
      ok: false,
      error: 'type.type must be a non-empty string',
    })
    expect(validateStepSpec({ wait: -1 })).toEqual({
      ok: false,
      error: 'wait.wait must be >= 0',
    })
    expect(validateStepSpec({ waitFor: '#ready', timeoutMs: 'slow' })).toEqual({
      ok: false,
      error: 'waitFor.timeoutMs must be a finite number',
    })
    expect(validateStepSpec({ press: 'Enter', selector: '#editor', extra: true })).toEqual({
      ok: false,
      error: 'press step has unsupported field(s): extra',
    })
    expect(validateStepSpec({ dispatch: { type: 'Teleport', nodeId: 'x' } })).toEqual({
      ok: false,
      error: 'dispatch.dispatch.type must be one of: Collapse, Expand, Select, Deselect, AddNode, RemoveNode, AddEdge, RemoveEdge, Move, LoadRoot, UnloadRoot, SetZoom, SetPan, SetPositions, RequestFit',
    })
  })
})
