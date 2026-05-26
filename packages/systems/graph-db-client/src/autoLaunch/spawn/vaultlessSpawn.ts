import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { GraphDbClient } from '../../GraphDbClient.ts'
import { resolveDaemonRuntimeCommand } from './runtime.ts'

const requireFromHere = createRequire(import.meta.url)
const DEFAULT_READY_TIMEOUT_MS = 15_000

const VAULTLESS_DAEMON_SCRIPT = `
import { startDaemon, startParentPidWatchdog } from '@vt/graph-db-server/server'

const swallowEpipe = (stream) => {
  stream.on('error', (err) => {
    if (err.code !== 'EPIPE') throw err
  })
}
swallowEpipe(process.stdout)
swallowEpipe(process.stderr)

let handle
try {
  handle = await startDaemon({
    appSupportPath: process.env.VOICETREE_APP_SUPPORT,
    onShutdownComplete: () => process.exit(0),
  })
} catch (err) {
  process.stderr.write('vt-graphd: fatal: ' + (err instanceof Error ? err.message : String(err)) + '\\n')
  process.exit(1)
}

process.stdout.write(JSON.stringify({ type: 'ready', port: handle.port }) + '\\n')

let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write('vt-graphd: ' + signal + ' received, shutting down\\n')
  try {
    await handle.stop()
    process.exit(0)
  } catch (err) {
    process.stderr.write('vt-graphd: shutdown error: ' + (err instanceof Error ? err.message : String(err)) + '\\n')
    process.exit(1)
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

const parentPidEnv = process.env.VOICETREE_PARENT_PID
if (parentPidEnv) {
  const parentPid = Number.parseInt(parentPidEnv, 10)
  if (Number.isInteger(parentPid) && parentPid > 0) {
    startParentPidWatchdog({
      onParentGone: () => void shutdown('PARENT_GONE'),
      parentPid,
    })
  } else {
    process.stderr.write('vt-graphd: ignoring invalid VOICETREE_PARENT_PID=' + parentPidEnv + '\\n')
  }
}
`

export type VaultlessDaemonHandle = {
  client: GraphDbClient
  process: ChildProcessWithoutNullStreams
  pid: number | null
  port: number
}

export type SpawnVaultlessDaemonOptions = {
  /** App-support path piped through VOICETREE_APP_SUPPORT to the child. */
  appSupportPath: string
  /** Optional: override tsx loader path. Defaults to createRequire(import.meta.url).resolve('tsx'). */
  tsxLoaderPath?: string
  /** Optional: ready-handshake timeout (default 15_000). */
  readyTimeoutMs?: number
}

function parseReadyLine(line: string): { port: number } | null {
  try {
    const parsed = JSON.parse(line) as { type?: unknown; port?: unknown }
    return parsed.type === 'ready' && typeof parsed.port === 'number'
      ? { port: parsed.port }
      : null
  } catch {
    return null
  }
}

export async function spawnVaultlessDaemon(
  opts: SpawnVaultlessDaemonOptions,
): Promise<VaultlessDaemonHandle> {
  const runtimeCommand = resolveDaemonRuntimeCommand()
  const tsxLoader = opts.tsxLoaderPath ?? requireFromHere.resolve('tsx')
  const child = spawn(runtimeCommand, ['--import', tsxLoader, '--eval', VAULTLESS_DAEMON_SCRIPT], {
    env: {
      ...process.env,
      VOICETREE_APP_SUPPORT: opts.appSupportPath,
      VOICETREE_PARENT_PID: String(process.pid),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.end()

  const stderrChunks: string[] = []
  child.stderr.on('data', (chunk: Buffer | string) => {
    const text = String(chunk)
    stderrChunks.push(text)
    process.stderr.write(text)
  })

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for vt-graphd readiness. ${stderrChunks.join('').trim()}`))
    }, opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)

    const onStdoutData = (chunk: Buffer | string): void => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue
        const ready = parseReadyLine(line)
        if (!ready) {
          process.stdout.write(`${line}\n`)
          continue
        }
        cleanup()
        resolve(ready.port)
      }
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(new Error(`vt-graphd exited before readiness code=${code ?? 'null'} signal=${signal ?? 'null'}. ${stderrChunks.join('').trim()}`))
    }

    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }

    function cleanup(): void {
      clearTimeout(timeout)
      child.stdout.off('data', onStdoutData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    child.stdout.on('data', onStdoutData)
    child.once('exit', onExit)
    child.once('error', onError)
  })

  const client = new GraphDbClient({ baseUrl: `http://127.0.0.1:${port}` })
  await client.health()
  return {
    client,
    pid: child.pid ?? null,
    port,
    process: child,
  }
}
