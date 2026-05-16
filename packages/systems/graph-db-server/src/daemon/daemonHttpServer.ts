import type { AddressInfo, Socket } from 'node:net'
import type { Server } from 'node:http'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { DaemonLogger } from './daemonTypes.ts'

const tracer = trace.getTracer('vt-graphd')

export type BoundDaemonHttpServer = {
  readonly port: number
  close(): Promise<void>
}

type BindDaemonHttpServerOptions = {
  readonly app: Hono
  readonly port: number
  readonly logger: DaemonLogger
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function shouldRejectRemoteAddress(remoteAddress: string | undefined): boolean {
  return !remoteAddress || !isLoopbackAddress(remoteAddress)
}

function formatRejectedConnectionMessage(remoteAddress: string | undefined): string {
  return `vt-graphd: rejected non-loopback connection from ${remoteAddress ?? 'unknown'}\n`
}

function createListenPromise(): {
  readonly promise: Promise<number>
  readonly resolve: (port: number) => void
  readonly reject: (err: Error) => void
} {
  let resolve: (port: number) => void
  let reject: (err: Error) => void
  const promise = new Promise<number>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve: resolve!, reject: reject! }
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
    // Drop keep-alive idle sockets so close() resolves promptly.
    ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
  })
}

function createIdempotentClose(server: Server): () => Promise<void> {
  let closed = false
  return async () => {
    if (closed) {
      return
    }
    closed = true
    await closeHttpServer(server)
  }
}

export async function bindDaemonHttpServer(
  options: BindDaemonHttpServerOptions,
): Promise<BoundDaemonHttpServer> {
  return tracer.startActiveSpan('daemon.http-serve', async (span) => {
    let server: Server | null = null
    try {
      const listener = createListenPromise()
      server = serve(
        {
          fetch: options.app.fetch,
          hostname: '127.0.0.1',
          port: options.port,
        },
        (info: AddressInfo) => listener.resolve(info.port),
      ) as Server

      server.on('error', (err) => {
        listener.reject(err as Error)
      })
      server.on('connection', (socket: Socket) => {
        const remote = socket.remoteAddress
        if (shouldRejectRemoteAddress(remote)) {
          options.logger.writeStderr(formatRejectedConnectionMessage(remote))
          socket.destroy()
        }
      })

      const assignedPort = await listener.promise
      span.setAttribute('port', assignedPort)
      return {
        port: assignedPort,
        close: createIdempotentClose(server),
      }
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      if (server) {
        await closeHttpServer(server).catch(() => {})
      }
      throw err
    } finally {
      span.end()
    }
  })
}
