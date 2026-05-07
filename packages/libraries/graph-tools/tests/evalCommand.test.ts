import { describe, expect, it } from 'vitest'

import { serializeEvalValue } from '../src/commands/eval'

describe('serializeEvalValue', () => {
  it('preserves plain JSON-like data', () => {
    expect(
      serializeEvalValue({
        count: 3,
        label: 'hello',
        nested: [true, null, { ok: true }],
      }),
    ).toEqual({
      count: 3,
      label: 'hello',
      nested: [true, null, { ok: true }],
    })
  })

  it('stringifies values that JSON transport would otherwise lose', () => {
    expect(
      serializeEvalValue({
        undef: undefined,
        big: 42n,
        sym: Symbol('vt'),
        fn: function sample() {
          return 'noop'
        },
      }),
    ).toEqual({
      undef: 'undefined',
      big: '42',
      sym: 'Symbol(vt)',
      fn: expect.stringContaining('sample'),
    })
  })

  it('serializes Maps, Sets, Errors, and RegExp to transport-safe shapes', () => {
    const err = new Error('boom')
    const serialized = serializeEvalValue({
      map: new Map([[1, 'one']]),
      set: new Set(['a', 'b']),
      err,
      regex: /vt-debug/gi,
    })

    expect(serialized).toEqual({
      map: { $type: 'Map', entries: [[1, 'one']] },
      set: { $type: 'Set', values: ['a', 'b'] },
      err: {
        name: 'Error',
        message: 'boom',
        stack: expect.any(String),
      },
      regex: '/vt-debug/gi',
    })
  })

  it('avoids invoking getters and breaks circular references', () => {
    const circular: Record<string, unknown> = { name: 'root' }
    circular.self = circular

    let getterCalls = 0
    const obj = {}
    Object.defineProperty(obj, 'computed', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'hidden'
      },
    })

    expect(
      serializeEvalValue({
        circular,
        obj,
      }),
    ).toEqual({
      circular: {
        name: 'root',
        self: '[Circular]',
      },
      obj: {
        computed: '[Getter]',
      },
    })
    expect(getterCalls).toBe(0)
  })

  it('falls back for custom instances and DOM-like objects', () => {
    class CustomValue {}

    expect(
      serializeEvalValue({
        custom: new CustomValue(),
        element: {
          nodeType: 1,
          tagName: 'DIV',
          id: 'root',
          className: 'alpha beta',
        },
      }),
    ).toEqual({
      custom: '[CustomValue]',
      element: '<div#root.alpha.beta>',
    })
  })
})
