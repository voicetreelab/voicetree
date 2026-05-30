#!/usr/bin/env npx tsx

// vt-debug — agent debugger CLI
// Each subcommand lives in src/commands/<name>.ts and self-registers via
// registerCommand. Import it here to trigger registration.
// Wave-3a agents add their command file + ONE import line here.

import '../src/commands/session/attach'   // registers 'attach'
import '../src/commands/capture/capture'  // registers 'capture'
import '../src/commands/capture/diff'     // registers 'diff'
import '../src/commands/capture/drift'    // registers 'drift'
import '../src/commands/session/eval'     // registers 'eval'
import '../src/commands/folders/folderAspect' // registers 'folder-aspect'
import '../src/commands/folders/folderMaterialize' // registers 'folder-materialize'
import '../src/commands/session/keyboard' // registers 'keyboard'
import '../src/commands/session/ls'        // registers 'ls'
import '../src/commands/session/log'       // registers 'log'
import '../src/commands/session/node'      // registers 'node'
import '../src/commands/session/nodeClick' // registers 'node-click'
import '../src/commands/session/pageAx'    // registers 'page-ax'
import '../src/commands/capture/run'       // registers 'run'
import '../src/commands/session/screenshot' // registers 'screenshot'
import '../src/commands/session/whyBlank'  // registers 'why-blank'
import { commandRegistry } from '../src/commands/index'
import type { Response } from '../src/debug/protocol/Response'

const argv = process.argv.slice(2)

const SELECTOR_FLAGS_HELP = [
  'Shared selector flags:',
  '  --port <N>      Target a specific registered dev session by CDP port.',
  '  --cdpPort <N>   Backward-compatible alias for --port.',
  '  --pid <N>       Target a specific registered dev process.',
  '  --project <path>  Target a specific registered dev project path.',
  '  --new           Launch a fresh dev session even if one already exists (preferred if testing new code).',
]

function helpText(): string {
  return [
    'Usage: vt debug <command> [args]',
    '',
    ...SELECTOR_FLAGS_HELP,
    '',
    'Auto-launch:',
    '  If no selector is provided and a dev session exists, vt debug warns and asks you to',
    '  use --port to reuse it or --new to launch fresh. If no session exists, it auto-launches',
    '  `npm --prefix webapp run electron:debug` on a free CDP port and prints that port to stderr.',
    '  Only registered dev sessions with a live /json/version endpoint are considered; packaged prod is ignored.',
    '',
    'Run `vt debug <command> --help` for command-specific usage (does not launch Electron).',
    '',
    `Commands: ${[...commandRegistry.keys()].sort().join(', ')}`,
  ].join('\n')
}

// Per-command usage text. Keyed by the REGISTERED (hyphenated) command name —
// the same key `resolveCommand` returns after collapsing two-token aliases
// (`folder materialize` -> `folder-materialize`, `node click` -> `node-click`).
// These mirror the arg parsing in each src/commands/* handler. Every CDP-backed
// command also accepts the shared selector flags, appended below.
const COMMAND_USAGE: Record<string, readonly string[]> = {
  attach: ['vt debug attach'],
  capture: ['vt debug capture [--tag NAME] [-o|--out PATH]'],
  diff: ['vt debug diff <snapshot-a> <snapshot-b>'],
  drift: ['vt debug drift [--deep]'],
  eval: ['vt debug eval <js>'],
  'folder-aspect': ['vt debug folder-aspect [--threshold N] [--min-children N]'],
  'folder-materialize': ['vt debug folder-materialize [--timeout-ms N]'],
  keyboard: ['vt debug keyboard <type|press> ... [--delay-ms N]'],
  log: ['vt debug log [--since-ms N]'],
  ls: ['vt debug ls'],
  node: ['vt debug node <id>'],
  'node-click': ['vt debug node-click <id> <label|index>'],
  'page-ax': ['vt debug page-ax [--selector CSS]'],
  run: ['vt debug run <spec-file|inline-json> [flags]'],
  screenshot: ['vt debug screenshot [--selector CSS] [--full-page] [--base64] [-o|--out PATH]'],
  'why-blank': ['vt debug why-blank [--seed SCENARIO]'],
}

function commandHelpText(command: string): string {
  const usage = COMMAND_USAGE[command] ?? [`vt debug ${command} [args]`]
  return [
    'Usage:',
    ...usage.map((line) => `  ${line}`),
    '',
    ...SELECTOR_FLAGS_HELP,
  ].join('\n')
}

function wantsHelp(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--help' || arg === '-h')
}

function resolveCommand(args: string[]): { subcommand: string; rest: string[] } {
  const [first, second, ...remaining] = args
  if (first && second) {
    const twoTokenAlias = `${first}-${second}`
    if (commandRegistry.has(twoTokenAlias)) {
      return { subcommand: twoTokenAlias, rest: remaining }
    }
  }

  return {
    subcommand: first ?? '',
    rest: first ? args.slice(1) : [],
  }
}

const { subcommand, rest } = resolveCommand(argv)

if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
  process.stdout.write(`${helpText()}\n`)
  process.exit(0)
}

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
  process.stdout.write(`${helpText()}\n`)
  process.exit(0)
}

const handler = commandRegistry.get(subcommand)
if (!handler) {
  usageError(`unknown subcommand: "${subcommand}"`)
}

// `vt-debug <command> --help` prints command usage and exits 0 WITHOUT invoking
// the handler. Invoking the handler would call resolveDebugInstance, which
// auto-launches `npm --prefix webapp run electron:debug` before any --help is
// handled — so help must short-circuit ahead of dispatch. See REC 8.
if (wantsHelp(rest)) {
  process.stdout.write(`${commandHelpText(subcommand)}\n`)
  process.exit(0)
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
