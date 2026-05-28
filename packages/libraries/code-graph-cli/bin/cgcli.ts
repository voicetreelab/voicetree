#!/usr/bin/env npx tsx
/**
 * cgcli — symbol-aware code-graph CLI for agent-driven exploration.
 *
 * Commands:
 *   find-symbol <name> [--mode exact|prefix|regex]
 *   callers     <fnId>
 *   callees     <fnId>
 *   reachable   <fnId>
 *   imports     <file>
 *   hotspots                          [--limit N]
 *
 * fnId format: `file:line:name` (as printed by find-symbol).
 *
 * Global flags:
 *   --format json|human   (default: json)
 *
 * Exit codes:
 *   0  success
 *   1  unknown command / bad args / unknown fnId
 *   2  unexpected runtime error
 */
import {resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {loadGraph} from '../src/graph/load-graph.ts'
import {callers} from '../src/commands/callers.ts'
import {callees} from '../src/commands/callees.ts'
import {reachable} from '../src/commands/reachable.ts'
import {imports} from '../src/commands/imports.ts'
import {findSymbol, type FindSymbolMode} from '../src/commands/find-symbol.ts'
import {hotspots} from '../src/commands/hotspots.ts'
import {format, type OutputFormat} from '../src/format/output.ts'

const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

type ParsedFlags = {
    readonly format: OutputFormat
    readonly mode: FindSymbolMode
    readonly limit: number
    readonly positional: readonly string[]
}

function emit(value: unknown, fmt: OutputFormat): void {
    process.stdout.write(format(value, fmt) + '\n')
}

async function main(): Promise<void> {
    const [, , command, ...rest] = process.argv
    if (!command || command === '--help' || command === '-h') {
        printUsage()
        process.exit(command ? 0 : 1)
    }
    const flags = parseFlags(rest)
    await dispatch(command, flags)
}

async function dispatch(command: string, flags: ParsedFlags): Promise<void> {
    if (command === 'find-symbol') return runFindSymbol(flags)
    if (command === 'callers') return runIdCommand(flags, callers)
    if (command === 'callees') return runIdCommand(flags, callees)
    if (command === 'reachable') return runIdCommand(flags, reachable)
    if (command === 'imports') return runImports(flags)
    if (command === 'hotspots') return runHotspots(flags)
    fail(`Unknown command: ${command}`)
}

async function runFindSymbol(flags: ParsedFlags): Promise<void> {
    const [query] = flags.positional
    requireArg(query, 'find-symbol <name>')
    const graph = await loadGraph({mode: 'repo'})
    emit(findSymbol(graph, query, flags.mode), flags.format)
}

async function runIdCommand(
    flags: ParsedFlags,
    fn: (graph: Awaited<ReturnType<typeof loadGraph>>, id: string) => unknown,
): Promise<void> {
    const [id] = flags.positional
    requireArg(id, '<command> <fnId>')
    const graph = await loadGraph({mode: 'repo'})
    emit(fn(graph, id), flags.format)
}

async function runImports(flags: ParsedFlags): Promise<void> {
    const [file] = flags.positional
    requireArg(file, 'imports <file>')
    const graph = await loadGraph({mode: 'repo'})
    emit(imports(graph, file, REPO_ROOT), flags.format)
}

async function runHotspots(flags: ParsedFlags): Promise<void> {
    const graph = await loadGraph({mode: 'repo'})
    emit(hotspots(graph, flags.limit), flags.format)
}

function parseFlags(args: readonly string[]): ParsedFlags {
    let format: OutputFormat = 'json'
    let mode: FindSymbolMode = 'exact'
    let limit = 20
    const positional: string[] = []
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--format') { format = requireOneOf(args[++i], ['json', 'human'], '--format'); continue }
        if (arg === '--mode') { mode = requireOneOf(args[++i], ['exact', 'prefix', 'regex'], '--mode'); continue }
        if (arg === '--limit') { limit = requirePositive(args[++i], '--limit'); continue }
        if (arg.startsWith('--')) fail(`Unknown flag: ${arg}`)
        positional.push(arg)
    }
    return {format, mode, limit, positional}
}

function requireOneOf<T extends string>(value: string | undefined, choices: readonly T[], flag: string): T {
    if (value !== undefined && (choices as readonly string[]).includes(value)) return value as T
    fail(`${flag} must be ${choices.join('|')} (got: ${value})`)
}

function requirePositive(value: string | undefined, flag: string): number {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n
    fail(`${flag} must be positive number (got: ${value})`)
}

function requireArg(value: string | undefined, usage: string): asserts value is string {
    if (value && value.length > 0) return
    fail(`Missing argument. Usage: cgcli ${usage}`)
}

function fail(message: string): never {
    process.stderr.write(`${message}\n`)
    process.exit(1)
}

function printUsage(): void {
    process.stdout.write([
        'cgcli — symbol-aware code-graph CLI',
        '',
        'Commands:',
        '  find-symbol <name> [--mode exact|prefix|regex]',
        '  callers     <fnId>',
        '  callees     <fnId>',
        '  reachable   <fnId>',
        '  imports     <file>',
        '  hotspots    [--limit N]',
        '',
        'fnId format: file:line:name (printed by find-symbol).',
        'Flags: --format json|human (default: json).',
        '',
    ].join('\n'))
}

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(error instanceof Error && error.message.includes('Unknown function id') ? 1 : 2)
})
