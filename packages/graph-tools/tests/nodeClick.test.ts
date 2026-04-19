import { describe, expect, it } from 'vitest'

import { parseButtonMatch, selectButton } from '../src/commands/nodeClick'

const BUTTONS = [
  { label: 'Delete', enabled: true },
  { label: 'Add Child', enabled: true },
  { label: 'More', enabled: true },
] as const

describe('parseButtonMatch', () => {
  it('treats integer tokens as zero-based button indexes', () => {
    expect(parseButtonMatch('1')).toEqual({ kind: 'index', index: 1 })
    expect(parseButtonMatch('01')).toEqual({ kind: 'index', index: 1 })
  })

  it('treats non-integer tokens as labels', () => {
    expect(parseButtonMatch('Add Child')).toEqual({ kind: 'label', label: 'Add Child' })
  })
})

describe('selectButton', () => {
  it('selects a button by zero-based index', () => {
    const result = selectButton(BUTTONS, '1')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected selection to succeed')
    expect(result.index).toBe(1)
    expect(result.button.label).toBe('Add Child')
    expect(result.matchedBy).toEqual({ kind: 'index', index: 1 })
  })

  it('selects a button by normalized label match', () => {
    const result = selectButton(BUTTONS, '  add   child ')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected selection to succeed')
    expect(result.index).toBe(1)
    expect(result.button.label).toBe('Add Child')
    expect(result.matchedBy).toEqual({ kind: 'label', label: '  add   child ' })
  })

  it('reports out-of-range indexes clearly', () => {
    expect(selectButton(BUTTONS, '8')).toEqual({
      ok: false,
      error: 'button index out of range: 8 (have 3 buttons, zero-based)',
    })
  })

  it('reports ambiguous label matches', () => {
    expect(
      selectButton(
        [
          { label: 'Add Child' },
          { label: ' add   child ' },
        ],
        'Add Child',
      ),
    ).toEqual({
      ok: false,
      error: 'button label is ambiguous: Add Child',
    })
  })
})
