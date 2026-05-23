#!/usr/bin/env npx tsx
import path from 'path'
import {createHeadlessServer} from '../src/live/headlessServer'

const [,, subcommand, ...args] = process.argv

function fail(msg: string): never {
    process.stderr.write(`${msg}\n`)
    process.exit(1)
}

if (subcommand !== 'serve') {
    fail('Usage: vt-headless serve [--port N] [--project-root <path>]')
}

let portArg = 0
let projectRootArg: string | undefined

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
    if (arg === '--project-root') {
        const next = args[++i]
        if (!next || next.startsWith('--')) fail('--project-root requires a path')
        projectRootArg = next
        continue
    }
    if (arg.startsWith('--project-root=')) {
        projectRootArg = arg.slice('--project-root='.length)
        continue
    }
    if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`)
}

const projectRoot = projectRootArg ? path.resolve(projectRootArg) : undefined

if (projectRoot) {
    process.stderr.write(`[vt-headless] Loading project root from ${projectRoot}...\n`)
}

const server = await createHeadlessServer({port: portArg, projectRoot})

process.stdout.write(`Listening on port ${server.port}\n`)

process.on('SIGINT', () => {
    process.stderr.write('[vt-headless] Shutting down...\n')
    void server.close().then(() => process.exit(0))
})
