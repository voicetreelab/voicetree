#!/usr/bin/env npx tsx
import {createHash} from 'node:crypto'
import {homedir} from 'node:os'
import path from 'node:path'
import {createHeadlessServer} from '../src/live/headlessServer'

const [,, subcommand, ...args] = process.argv

function fail(msg: string): never {
    process.stderr.write(`${msg}\n`)
    process.exit(1)
}

if (subcommand !== 'serve') {
    fail('Usage: vt-headless serve [--socket <path>] [--vault <path>]')
}

let socketArg: string | undefined
let vaultArg: string | undefined

for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--socket') {
        const next = args[++i]
        if (!next || next.startsWith('--')) fail('--socket requires a path')
        socketArg = next
        continue
    }
    if (arg.startsWith('--socket=')) {
        socketArg = arg.slice('--socket='.length)
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

function defaultSocketPath(): string {
    if (vaultPath) {
        return path.join(vaultPath, '.voicetree', 'vt.sock')
    }
    // Headless without a vault: pick a per-cwd socket under $HOME/.voicetree.
    const hash: string = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16)
    return path.join(homedir(), '.voicetree', `${hash}.sock`)
}

const socketPath: string = socketArg ? path.resolve(socketArg) : defaultSocketPath()

if (vaultPath) {
    process.stderr.write(`[vt-headless] Loading vault from ${vaultPath}...\n`)
}

const server = await createHeadlessServer({socketPath, vaultPath})

process.stdout.write(`Listening on ${server.socketPath}\n`)

process.on('SIGINT', () => {
    process.stderr.write('[vt-headless] Shutting down...\n')
    void server.close().then(() => process.exit(0))
})
