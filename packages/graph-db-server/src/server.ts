import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AddressInfo, Socket } from 'node:net'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  CONTRACT_VERSION,
  HealthResponseSchema,
  ShutdownResponseSchema,
} from './contract.ts'
import { acquireLock } from './lock.ts'
import { writePortFile, readPortFile, deletePortFile } from './portFile.ts'
import { mountSessionRoutes } from './routes/sessions.ts'
import { SessionRegistry } from './session/registry.ts'

export type DaemonHandle = {
  port: number
  stop(): Promise<void>
  alreadyRunning?: { pid: number }
}

export type StartDaemonOptions = {
  vault: string
  port?: number
  logLevel?: 'info' | 'debug'
  idleTimeoutMs?: number
  // Called after /shutdown finishes its teardown (server close, lock release,
  // port-file delete). The bin sets this to process.exit(0); tests leave it
  // unset so vitest workers survive.
  onShutdownComplete?: () => void | Promise<void>
}

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export async function startDaemon(
  opts: StartDaemonOptions,
): Promise<DaemonHandle> {
  const vault = resolve(opts.vault)
  const dotDir = join(vault, '.voicetree')
  await mkdir(dotDir, { recursive: true })

  const lockResult = await acquireLock(vault)
  if ('kind' in lockResult) {
    const existingPort = (await readPortFile(vault)) ?? 0
    process.stderr.write(
      `vt-graphd: already running for ${vault} (pid ${lockResult.pid})\n`,
    )
    return {
      port: existingPort,
      alreadyRunning: { pid: lockResult.pid },
      stop: async () => {},
    }
  }

  const lockHandle = lockResult
  const startMs = Date.now()
  const app = new Hono()
  const registry = new SessionRegistry()
  const idleTimeoutMs = opts.idleTimeoutMs ?? 24 * 60 * 60 * 1000

  let idleSessionTimer: ReturnType<typeof setInterval> | null = setInterval(
    () => {
      registry.purgeIdle(idleTimeoutMs)
    },
    60_000,
  )
  idleSessionTimer.unref()

  const clearIdleSessionTimer = () => {
    if (!idleSessionTimer) {
      return
    }
    clearInterval(idleSessionTimer)
    idleSessionTimer = null
  }

  mountSessionRoutes(app, registry)

  app.get('/health', (c) => {
    const body = HealthResponseSchema.parse({
      version: CONTRACT_VERSION,
      vault,
      uptimeSeconds: Math.floor((Date.now() - startMs) / 1000),
      sessionCount: registry.size(),
    })
    return c.json(body)
  })

  let shuttingDown = false
  app.post('/shutdown', (c) => {
    const body = ShutdownResponseSchema.parse({ ok: true })
    if (!shuttingDown) {
      shuttingDown = true
      queueMicrotask(() => {
        void (async () => {
          try {
            clearIdleSessionTimer()
            await closeServer()
          } finally {
            await lockHandle.release()
            await deletePortFile(vault)
            await opts.onShutdownComplete?.()
          }
        })()
      })
    }
    return c.json(body)
  })

  let listenResolve: (port: number) => void
  let listenReject: (err: Error) => void
  const listenPromise = new Promise<number>((res, rej) => {
    listenResolve = res
    listenReject = rej
  })

  let server: Server
  let closeServer: () => Promise<void>
  try {
    server = serve(
      {
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: opts.port ?? 0,
      },
      (info: AddressInfo) => listenResolve(info.port),
    ) as Server
    closeServer = () =>
      new Promise<void>((res, rej) => {
        server.close((err) => (err ? rej(err) : res()))
        // Drop keep-alive idle sockets so close() resolves promptly.
        ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
      })
  } catch (err) {
    clearIdleSessionTimer()
    await lockHandle.release()
    throw err
  }

  server.on('error', (err) => {
    listenReject(err as Error)
  })

  server.on('connection', (socket: Socket) => {
    const remote = socket.remoteAddress
    if (!remote || !LOOPBACK_ADDRS.has(remote)) {
      process.stderr.write(
        `vt-graphd: rejected non-loopback connection from ${remote ?? 'unknown'}\n`,
      )
      socket.destroy()
    }
  })

  let assignedPort: number
  try {
    assignedPort = await listenPromise
  } catch (err) {
    clearIdleSessionTimer()
    await lockHandle.release()
    throw err
  }

  await writePortFile(vault, assignedPort)

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    shuttingDown = true
    try {
      clearIdleSessionTimer()
      await closeServer()
    } finally {
      await lockHandle.release()
      await deletePortFile(vault)
    }
  }

  return { port: assignedPort, stop }
}
