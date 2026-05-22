import { afterEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { SessionRegistry } from '../../../application/session/registry.ts'
import { mountViewRoutes } from '../../graph-endpoints/view.ts'

describe('view routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('POST and DELETE expand overrides update the session', async () => {
    const registry = new SessionRegistry()
    const session = registry.create()
    const app = new Hono()
    mountViewRoutes(app, registry)

    const addResponse = await app.fetch(
      new Request(`http://localhost/sessions/${session.id}/expand/docs`, {
        method: 'POST',
      }),
    )

    expect(addResponse.status).toBe(200)
    expect(await addResponse.json()).toEqual({ expandOverrides: ['docs'] })
    expect(session.expandOverrides).toEqual(new Set<string>(['docs']))

    const deleteResponse = await app.fetch(
      new Request(`http://localhost/sessions/${session.id}/expand/docs`, {
        method: 'DELETE',
      }),
    )

    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({ expandOverrides: [] })
    expect(session.expandOverrides).toEqual(new Set<string>())
  })

  test('expand override mutations return 404 for a missing session', async () => {
    const app = new Hono()
    mountViewRoutes(app, new SessionRegistry())

    const response = await app.fetch(
      new Request(
        'http://localhost/sessions/00000000-0000-4000-8000-000000000000/expand/docs',
        { method: 'POST' },
      ),
    )

    expect(response.status).toBe(404)
  })

  test('expand override mutations touch lastAccessedAt after lookup', async () => {
    const registry = new SessionRegistry()
    const session = registry.create()
    session.lastAccessedAt = 100

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(200).mockReturnValueOnce(300)

    const app = new Hono()
    mountViewRoutes(app, registry)

    const response = await app.fetch(
      new Request(`http://localhost/sessions/${session.id}/expand/docs`, {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(session.lastAccessedAt).toBe(300)
  })
})
