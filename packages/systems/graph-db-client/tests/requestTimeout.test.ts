import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { createRequest } from '../src/client/requestCore.ts'
import { GraphDbRequestTimeoutError } from '../src/errors.ts'
import { UnknownResponseSchema } from '../src/responseSchemas.ts'

/**
 * Black-box coverage for the graphd transport deadline. The failure these
 * guard against is a daemon that accepts the TCP connection and then never
 * answers: before the deadline existed, the client `await` hung forever,
 * which is exactly what froze the renderer's "loading workspace" spinner.
 *
 * We exercise the real {@link createRequest} against a real `node:http`
 * server — no mocked fetch — and assert on the observable outcome (a bounded
 * rejection vs. a resolved value), never on internal calls.
 */
describe('graph-db-client request deadline', () => {
  let server: Server | null = null
  const liveSockets = new Set<Socket>()

  async function startServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<string> {
    const created = createServer(handler)
    created.on('connection', (socket: Socket) => {
      liveSockets.add(socket)
      socket.on('close', () => liveSockets.delete(socket))
    })
    await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve))
    server = created
    const address = created.address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address from the test server')
    }
    return `http://127.0.0.1:${address.port}`
  }

  afterEach(async () => {
    // Destroy any socket the stalling handler is still holding so the server
    // can actually close and vitest does not hang on an open handle.
    for (const socket of liveSockets) socket.destroy()
    liveSockets.clear()
    const toClose = server
    server = null
    if (toClose !== null) {
      await new Promise<void>((resolve) => toClose.close(() => resolve()))
    }
  })

  test('aborts a stalled request with GraphDbRequestTimeoutError within the bound', async () => {
    // Handler that accepts the request but never responds.
    const baseUrl = await startServer(() => {})
    const request = createRequest(baseUrl)

    const startedAt = Date.now()
    const error = await request('/project', {
      method: 'GET',
      timeoutMs: 150,
      responseSchema: UnknownResponseSchema,
    }).then(
      () => {
        throw new Error('expected the stalled request to reject, but it resolved')
      },
      (caught: unknown) => caught,
    )
    const elapsedMs = Date.now() - startedAt

    expect(error).toBeInstanceOf(GraphDbRequestTimeoutError)
    expect((error as GraphDbRequestTimeoutError).timeoutMs).toBe(150)
    // The whole point: the call is bounded, not hung. Generous ceiling keeps
    // CI green while still failing a regression back to an unbounded await.
    expect(elapsedMs).toBeLessThan(2_000)
  })

  test('a prompt response resolves normally — the deadline never fires', async () => {
    const baseUrl = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    const request = createRequest(baseUrl)

    const result = await request('/project', {
      method: 'GET',
      timeoutMs: 1_000,
      responseSchema: UnknownResponseSchema,
    })

    expect(result).toEqual({ ok: true })
  })
})
