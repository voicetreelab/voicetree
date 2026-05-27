#!/usr/bin/env -S node --import tsx
import { resolve } from 'node:path'
import { startDaemon } from '../src/daemon/server.ts'
import { tracing } from '@vt/observability'
import { perfProbeFromEnv } from '@vt/perf-analysis/perf-probe'

// The daemon is spawned detached by ensureDaemon with stderr piped to its
// parent. When the parent exits, writes to that pipe error with EPIPE. Without
// this listener, an EPIPE during shutdown's stderr write would surface as an
// uncaughtException and Node would exit before handle.stop() finished — leaving
// the port + lock files behind for the next launcher to find.
const swallowEpipe = (stream: NodeJS.WriteStream): void => {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}
swallowEpipe(process.stdout)
swallowEpipe(process.stderr)

type Args = {
  projectRoot: string
  logLevel: 'info' | 'debug'
  idleTimeoutMs?: number
}

function parseIdleTimeoutMs(value: string | undefined): number {
  if (!value) {
    die('missing required value for --idle-timeout-ms <milliseconds>')
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    die(`invalid --idle-timeout-ms: ${value}`)
  }
  return parsed
}

function parseArgs(argv: string[]): Args {
  let projectRoot: string | null = null
  let logLevel: 'info' | 'debug' = 'info'
  let idleTimeoutMs: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--project-root') {
      projectRoot = argv[++i] ?? null
    } else if (a === '--log-level') {
      const v = argv[++i]
      if (v === 'info' || v === 'debug') logLevel = v
      else die(`invalid --log-level: ${v}`)
    } else if (a === '--idle-timeout-ms') {
      idleTimeoutMs = parseIdleTimeoutMs(argv[++i])
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: vt-graphd --project-root <path> [--log-level info|debug] [--idle-timeout-ms milliseconds]\n',
      )
      process.exit(0)
    } else {
      die(`unknown argument: ${a}`)
    }
  }
  if (!projectRoot) die('missing required --project-root <path>')
  return { projectRoot: resolve(projectRoot), logLevel, idleTimeoutMs }
}

function die(msg: string): never {
  process.stderr.write(`vt-graphd: ${msg}\n`)
  process.exit(1)
}

async function main() {
  tracing.init('vt-graphd', {
    otlpEndpoint: process.env.VOICETREE_OTLP_ENDPOINT,
    instanceId: process.env.VOICETREE_RUN_INSTANCE_ID,
  })
  const stopPerfProbe = await perfProbeFromEnv('vt-graphd')
  const args = parseArgs(process.argv.slice(2))

  // A competing owner for the same vault now causes startDaemon to throw
  // DaemonOwnerConflictError loudly (BF-343 spec: fail loudly, never
  // silently overwrite). The catch below reports it as a non-zero exit so
  // any orchestrator can react.
  let handle
  try {
    handle = await startDaemon({
      vault: args.projectRoot,
      logLevel: args.logLevel,
      idleTimeoutMs: args.idleTimeoutMs,
      onShutdownComplete: async () => {
        await stopPerfProbe?.()
        process.exit(0)
      },
    })
  } catch (err) {
    process.stderr.write(`vt-graphd: fatal: ${(err as Error).message}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `vt-graphd: listening on http://127.0.0.1:${handle.port} for project root ${args.projectRoot}\n`,
  )

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write(`vt-graphd: ${signal} received, shutting down\n`)
    try {
      await handle.stop()
      await stopPerfProbe?.()
      process.exit(0)
    } catch (err) {
      process.stderr.write(`vt-graphd: shutdown error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
