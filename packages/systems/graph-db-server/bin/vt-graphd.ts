#!/usr/bin/env -S node --import tsx
import { resolve } from 'node:path'
import { startDaemon } from '../src/daemon/server.ts'
import { startParentPidWatchdog } from '../src/daemon/parentPidWatchdog.ts'
import { initTracing } from '../src/daemon/tracing.ts'

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
  vault: string
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
  let vault: string | null = null
  let logLevel: 'info' | 'debug' = 'info'
  let idleTimeoutMs: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--vault') {
      vault = argv[++i] ?? null
    } else if (a === '--log-level') {
      const v = argv[++i]
      if (v === 'info' || v === 'debug') logLevel = v
      else die(`invalid --log-level: ${v}`)
    } else if (a === '--idle-timeout-ms') {
      idleTimeoutMs = parseIdleTimeoutMs(argv[++i])
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: vt-graphd --vault <path> [--log-level info|debug] [--idle-timeout-ms milliseconds]\n',
      )
      process.exit(0)
    } else {
      die(`unknown argument: ${a}`)
    }
  }
  if (!vault) die('missing required --vault <path>')
  return { vault: resolve(vault!), logLevel, idleTimeoutMs }
}

function die(msg: string): never {
  process.stderr.write(`vt-graphd: ${msg}\n`)
  process.exit(1)
}

async function main() {
  initTracing('vt-graphd')
  const args = parseArgs(process.argv.slice(2))

  let handle
  try {
    handle = await startDaemon({
      vault: args.vault,
      logLevel: args.logLevel,
      idleTimeoutMs: args.idleTimeoutMs,
      onShutdownComplete: () => process.exit(0),
    })
  } catch (err) {
    process.stderr.write(`vt-graphd: fatal: ${(err as Error).message}\n`)
    process.exit(1)
  }

  if (handle.alreadyRunning) {
    // Stderr line already printed by startDaemon.
    process.exit(0)
  }

  process.stdout.write(
    `vt-graphd: listening on http://127.0.0.1:${handle.port} for vault ${args.vault}\n`,
  )

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write(`vt-graphd: ${signal} received, shutting down\n`)
    try {
      await handle.stop()
      process.exit(0)
    } catch (err) {
      process.stderr.write(`vt-graphd: shutdown error: ${(err as Error).message}\n`)
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
      process.stderr.write(`vt-graphd: ignoring invalid VOICETREE_PARENT_PID=${parentPidEnv}\n`)
    }
  }
}

void main()
