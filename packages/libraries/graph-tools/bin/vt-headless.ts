#!/usr/bin/env npx tsx
import path from 'node:path'
import {createHeadlessServer} from '../src/live/headlessServer'

const [,, subcommand, ...args] = process.argv

function fail(msg: string): never {
    process.stderr.write(`${msg}\n`)
    process.exit(1)
}

const USAGE: string = 'Usage: vt-headless serve --vault <path> [--port <port>] [--host <host>]'

if (subcommand !== 'serve') {
    fail(USAGE)
}

let vaultArg: string | undefined
let portArg: string | undefined
let hostArg: string | undefined

function takeValue(flag: string, nextIndex: number): string {
    const value: string | undefined = args[nextIndex]
    if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value`)
    return value
}

for (let i = 0; i < args.length; i++) {
    const arg: string = args[i]
    if (arg === '--vault') { vaultArg = takeValue('--vault', ++i); continue }
    if (arg.startsWith('--vault=')) { vaultArg = arg.slice('--vault='.length); continue }
    if (arg === '--port') { portArg = takeValue('--port', ++i); continue }
    if (arg.startsWith('--port=')) { portArg = arg.slice('--port='.length); continue }
    if (arg === '--host') { hostArg = takeValue('--host', ++i); continue }
    if (arg.startsWith('--host=')) { hostArg = arg.slice('--host='.length); continue }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
}

if (!vaultArg) fail(`--vault is required (target for .voicetree/rpc.port and auth-token).\n${USAGE}`)

const vaultPath: string = path.resolve(vaultArg)
const port: number = portArg !== undefined ? Number.parseInt(portArg, 10) : 0
if (!Number.isFinite(port) || port < 0 || port > 65535) {
    fail(`--port must be a number in [0, 65535], got: ${portArg}`)
}

process.stderr.write(`[vt-headless] Loading vault from ${vaultPath}...\n`)

const server = await createHeadlessServer({vaultPath, port, host: hostArg})

process.stdout.write(`Listening on ${server.url}\n`)

process.on('SIGINT', () => {
    process.stderr.write('[vt-headless] Shutting down...\n')
    void server.close().then(() => process.exit(0))
})
