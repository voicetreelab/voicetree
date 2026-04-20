import { describe, expect, it, vi } from 'vitest'

import { pressChord } from '../src/debug/pressChord'

describe('pressChord', () => {
  it('uses Playwright directly for plain keys', async () => {
    const page = {
      keyboard: {
        press: vi.fn(async () => undefined),
      },
      evaluate: vi.fn(async () => false),
    }

    const strategy = await pressChord(page, 'Enter')

    expect(strategy).toBe('playwright')
    expect(page.evaluate).not.toHaveBeenCalled()
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  it('uses the hotkey manager path for modifier chords when available', async () => {
    const page = {
      keyboard: {
        press: vi.fn(async () => undefined),
      },
      evaluate: vi.fn(async () => true),
    }

    const strategy = await pressChord(page, 'Meta+n')

    expect(strategy).toBe('hotkey-manager')
    expect(page.evaluate).toHaveBeenCalledOnce()
    expect(page.keyboard.press).not.toHaveBeenCalled()
  })

  it('falls back to Playwright when the hotkey manager path is unavailable', async () => {
    const page = {
      keyboard: {
        press: vi.fn(async () => undefined),
      },
      evaluate: vi.fn(async () => false),
    }

    const strategy = await pressChord(page, 'Meta+n')

    expect(strategy).toBe('playwright')
    expect(page.evaluate).toHaveBeenCalledOnce()
    expect(page.keyboard.press).toHaveBeenCalledWith('Meta+n')
  })
})
