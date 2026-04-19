#!/usr/bin/env npx tsx

// vt-debug — agent debugger CLI
// Each subcommand lives in src/commands/<name>.ts and self-registers via
// registerCommand. Import it here to trigger registration.
// Wave-3a agents add their command file + ONE import line here.

import '../src/commands/attach'   // registers 'attach'
import '../src/commands/capture'  // registers 'capture'
import '../src/commands/diff'     // registers 'diff'
import '../src/commands/drift'    // registers 'drift'
import '../src/commands/eval'     // registers 'eval'
import '../src/commands/keyboard' // registers 'keyboard'
import '../src/commands/ls'        // registers 'ls'
import '../src/commands/log'       // registers 'log'
import '../src/commands/node'      // registers 'node'
import '../src/commands/pageAx'    // registers 'page-ax'
import '../src/commands/screenshot' // registers 'screenshot'
import '../src/commands/whyBlank'  // registers 'why-blank'
import { commandRegistry } from '../src/commands/index'
import type { Response } from '../src/debug/Response'

const [, , subcommand, ...rest] = process.argv

function usageError(msg: string): never {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      command: subcommand ?? '',
      error: msg,
      hint: `available commands: ${[...commandRegistry.keys()].join(', ')}`,
    }) + '\n',
  )
  process.exit(2)
}

if (!subcommand) {
  usageError('no subcommand given')
}

const handler = commandRegistry.get(subcommand)
if (!handler) {
  usageError(`unknown subcommand: "${subcommand}"`)
}

let result: Response<unknown>
try {
  result = await handler(rest)
} catch (e) {
  process.stderr.write(
    JSON.stringify({ ok: false, command: subcommand, error: String(e) }) + '\n',
  )
  process.exit(1)
}

process.stdout.write(JSON.stringify(result) + '\n')

// Exit code: 0 ok, 1 command failure, 2 instance discovery, 3 CDP connect
const exitCode = result.ok
  ? 0
  : (result as { exitCode?: number }).exitCode ?? 1

process.exit(exitCode)
