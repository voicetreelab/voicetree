#!/usr/bin/env -S node --import tsx
import { resolve } from 'node:path'
import { startDaemon } from '../src/server.ts'

type Args = { vault: string; logLevel: 'info' | 'debug' }

function parseArgs(argv: string[]): Args {
  let vault: string | null = null
  let logLevel: 'info' | 'debug' = 'info'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--vault') {
      vault = argv[++i] ?? null
    } else if (a === '--log-level') {
      const v = argv[++i]
      if (v === 'info' || v === 'debug') logLevel = v
      else die(`invalid --log-level: ${v}`)
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: vt-graphd --vault <path> [--log-level info|debug]\n',
      )
      process.exit(0)
    } else {
      die(`unknown argument: ${a}`)
    }
  }
  if (!vault) die('missing required --vault <path>')
  return { vault: resolve(vault!), logLevel }
}

function die(msg: string): never {
  process.stderr.write(`vt-graphd: ${msg}\n`)
  process.exit(1)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let handle
  try {
    handle = await startDaemon({
      vault: args.vault,
      logLevel: args.logLevel,
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
}

void main()
