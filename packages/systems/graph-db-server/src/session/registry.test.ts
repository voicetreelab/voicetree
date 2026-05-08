import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { SessionRegistry } from './registry.ts'

describe('SessionRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('create seeds empty session state', () => {
    const registry = new SessionRegistry()

    const session = registry.create()

    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(session.collapseSet.size).toBe(0)
    expect(session.selection.size).toBe(0)
    expect(session.layout).toEqual({
      positions: {},
      pan: { x: 0, y: 0 },
      zoom: 1,
    })
    expect(session.lastAccessedAt).toBe(Date.now())
    expect(registry.size()).toBe(1)
  })

  test('get updates lastAccessedAt', () => {
    const registry = new SessionRegistry()
    const created = registry.create()

    vi.setSystemTime(new Date('2026-04-20T00:00:01.000Z'))
    const loaded = registry.get(created.id)

    expect(loaded).not.toBeNull()
    expect(loaded?.lastAccessedAt).toBe(Date.now())
  })

  test('delete removes the session', () => {
    const registry = new SessionRegistry()
    const session = registry.create()

    expect(registry.delete(session.id)).toBe(true)
    expect(registry.delete(session.id)).toBe(false)
    expect(registry.get(session.id)).toBeNull()
    expect(registry.size()).toBe(0)
  })

  test('touch updates lastAccessedAt without loading', () => {
    const registry = new SessionRegistry()
    const session = registry.create()

    vi.setSystemTime(new Date('2026-04-20T00:00:02.000Z'))
    registry.touch(session.id)

    expect(registry.get(session.id)?.lastAccessedAt).toBe(Date.now())
  })

  test('purgeIdle removes expired sessions and reports count', () => {
    const registry = new SessionRegistry()
    const session = registry.create()

    vi.setSystemTime(new Date('2026-04-20T00:00:05.000Z'))
    expect(registry.purgeIdle(0)).toBe(1)
    expect(registry.get(session.id)).toBeNull()
    expect(registry.size()).toBe(0)
  })

  test('create returns unique ids across many calls', () => {
    const registry = new SessionRegistry()

    const ids = new Set(
      Array.from({ length: 256 }, () => {
        const session = registry.create()
        return session.id
      }),
    )

    expect(ids.size).toBe(256)
  })

  test('parallel create loop does not collide ids', async () => {
    const registry = new SessionRegistry()

    const sessions = await Promise.all(
      Array.from({ length: 1000 }, async () => registry.create()),
    )

    expect(new Set(sessions.map((session) => session.id)).size).toBe(1000)
    expect(registry.size()).toBe(1000)
  })
})
