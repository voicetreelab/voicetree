import { describe, expect, test } from 'vitest'
import { applySelection } from './selection.ts'

describe('applySelection', () => {
  test('replace on empty set seeds the provided ids in order', () => {
    const selection = new Set<string>()

    const result = applySelection(selection, ['a', 'b'], 'replace')

    expect(result).toBe(selection)
    expect([...selection]).toEqual(['a', 'b'])
  })

  test('replace on non-empty set clears existing ids before adding', () => {
    const selection = new Set<string>(['stale', 'old'])

    applySelection(selection, ['fresh', 'next'], 'replace')

    expect([...selection]).toEqual(['fresh', 'next'])
  })

  test('add on empty set behaves like a union seed', () => {
    const selection = new Set<string>()

    applySelection(selection, ['a', 'b'], 'add')

    expect([...selection]).toEqual(['a', 'b'])
  })

  test('add on non-empty set keeps existing ids and appends new ones once', () => {
    const selection = new Set<string>(['a', 'b'])

    applySelection(selection, ['b', 'c', 'd'], 'add')

    expect([...selection]).toEqual(['a', 'b', 'c', 'd'])
  })

  test('remove on empty set is a no-op', () => {
    const selection = new Set<string>()

    applySelection(selection, ['a'], 'remove')

    expect([...selection]).toEqual([])
  })

  test('remove on non-empty set deletes only the requested ids', () => {
    const selection = new Set<string>(['a', 'b', 'c'])

    applySelection(selection, ['b', 'missing'], 'remove')

    expect([...selection]).toEqual(['a', 'c'])
  })
})
