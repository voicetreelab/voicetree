import { describe, expect, it } from 'vitest'
import { normalizeChord } from '../src/debug/normalizeChord'

describe('normalizeChord', () => {
  it('leaves plain keys unchanged', () => {
    expect(normalizeChord('Enter', 'darwin')).toBe('Enter')
  })

  it('normalizes Cmd to Meta on macOS', () => {
    expect(normalizeChord('Cmd+K', 'darwin')).toBe('Meta+K')
  })

  it('normalizes Cmd to Control outside macOS and keeps modifier chains', () => {
    expect(normalizeChord('Cmd+Shift+K', 'linux')).toBe('Control+Shift+K')
  })

  it('normalizes modifier aliases consistently', () => {
    expect(normalizeChord('ctrl+option+Delete', 'darwin')).toBe('Control+Alt+Delete')
  })
})
