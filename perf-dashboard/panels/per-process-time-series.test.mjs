import { describe, expect, test } from 'vitest'
import { FIELD_GROUPS, groupFields, numericFieldsFromRows } from './per-process-time-series.js'

function fieldToGroup(groups) {
  const mapping = new Map()
  for (const [groupName, fields] of groups) {
    for (const field of fields) {
      if (mapping.has(field)) throw new Error(`${field} mapped more than once`)
      mapping.set(field, groupName)
    }
  }
  return mapping
}

describe('per-process time-series field grouping', () => {
  test('maps known fields into chart groups and unknown numeric fields into single-field charts', () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      t: index,
      svc: 'vt-graphd',
      cpu_user_ms: index,
      rss: 100 + index,
      heap_used: 50 + index,
      eld_p99_ms: 1 + index,
      custom_unknown: index === 0 ? null : index,
    }))

    const numericFields = numericFieldsFromRows(rows)
    expect(numericFields).toEqual(['cpu_user_ms', 'rss', 'heap_used', 'eld_p99_ms', 'custom_unknown'])

    const groups = groupFields(numericFields, FIELD_GROUPS)
    const mapping = fieldToGroup(groups)

    expect(mapping.get('cpu_user_ms')).toBe('cpu')
    expect(mapping.get('rss')).toBe('memory')
    expect(mapping.get('heap_used')).toBe('memory')
    expect(mapping.get('eld_p99_ms')).toBe('event_loop')
    expect(mapping.get('custom_unknown')).toBe('custom_unknown')
    expect([...mapping.keys()].sort()).toEqual([...numericFields].sort())
  })
})
