#!/usr/bin/env npx tsx
import path from 'path'
import {createHeadlessServer} from '../src/headlessServer'

const [,, subcommand, ...args] = process.argv

function fail(msg: string): never {
    process.stderr.write(`${msg}\n`)
    process.exit(1)
}

if (subcommand !== 'serve') {
    fail('Usage: vt-headless serve [--port N] [--vault <path>]')
}

let portArg = 0
let vaultArg: string | undefined

for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--port') {
        const next = args[++i]
        if (!next || next.startsWith('--')) fail('--port requires a value')
        portArg = parseInt(next, 10)
        continue
    }
    if (arg.startsWith('--port=')) {
        portArg = parseInt(arg.slice('--port='.length), 10)
        continue
    }
    if (arg === '--vault') {
        const next = args[++i]
        if (!next || next.startsWith('--')) fail('--vault requires a path')
        vaultArg = next
        continue
    }
    if (arg.startsWith('--vault=')) {
        vaultArg = arg.slice('--vault='.length)
        continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
}

const vaultPath = vaultArg ? path.resolve(vaultArg) : undefined

if (vaultPath) {
    process.stderr.write(`[vt-headless] Loading vault from ${vaultPath}...\n`)
}

const server = await createHeadlessServer({port: portArg, vaultPath})

process.stdout.write(`Listening on port ${server.port}\n`)

process.on('SIGINT', () => {
    process.stderr.write('[vt-headless] Shutting down...\n')
    void server.close().then(() => process.exit(0))
})
