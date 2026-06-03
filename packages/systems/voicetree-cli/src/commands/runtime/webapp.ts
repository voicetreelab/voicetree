// `vt webapp` — run VoiceTree in the browser, no Electron.
//
// Boots both per-project daemons (reusing `vt serve`'s ensure), starts the
// webapp dev server (vite) pointed at the vt-daemon over HTTP, and opens the
// browser. The renderer installs window.hostAPI (the browser adapter) and talks
// ONLY to vt-daemon; vt-graphd stays loopback-internal behind it.
//
// Foreground dev command: Ctrl-C stops the vite dev server. The daemons are
// cross-process shared resources (BF-346) and are deliberately left running on
// exit, exactly as `vt serve` does — other peers (CLI, Electron) may still use
// them, and each daemon's own watchdog handles eventual shutdown.
//
// This command is dev-only: it serves the live vite source tree, so it is
// available solely in a monorepo checkout (it errors if webapp/ is absent).

import {spawn, type ChildProcess} from 'node:child_process'
import {existsSync} from 'node:fs'
import {networkInterfaces} from 'node:os'
import {resolve} from 'node:path'
import {error} from '../output'
import {readRequiredFlagValue} from './argv'
import {findRepoRoot} from '../util/findRepoRoot.ts'
import {ensureBothDaemons, type EnsuredDaemons} from './serve'

// The webapp's vite dev server binds this port by default (webapp/vite.config.ts).
const DEFAULT_PORT: number = 3000

const WEBAPP_USAGE: string =
    'Usage: vt webapp --project <path> [--port <n>] [--lan] [--no-open]\n'

type WebappArgs = {
    readonly project: string
    readonly port: number
    readonly open: boolean
    // --lan: serve on the LAN (vite --host) and point the renderer at this
    // machine's LAN IP so a phone/tablet on the same network can use the app.
    // Default false keeps everything bound to loopback (the secure default).
    readonly lan: boolean
}

// Resolve the repo root by walking up to the `.git` marker rather than counting
// `../` hops, so the path survives this file moving and stays clear of the
// relative-path-depth gate (see findRepoRoot's own docs).
const REPO_ROOT: string = findRepoRoot(import.meta.url)
const WEBAPP_DIR: string = resolve(REPO_ROOT, 'webapp')

const readRequiredValue = (argv: readonly string[], index: number, flag: string): string =>
    readRequiredFlagValue(argv, index, flag, WEBAPP_USAGE)

function parseWebappArgs(argv: readonly string[]): WebappArgs {
    let project: string | undefined
    let port: number = DEFAULT_PORT
    let open: boolean = true
    let lan: boolean = false

    for (let index: number = 0; index < argv.length; index += 1) {
        const arg: string = argv[index]

        if (arg === '--help' || arg === '-h') {
            process.stdout.write(WEBAPP_USAGE)
            process.exit(0)
        }
        if (arg === '--lan') {
            lan = true
            continue
        }
        if (arg === '--project') {
            project = readRequiredValue(argv, index, '--project')
            index += 1
            continue
        }
        if (arg.startsWith('--project=')) {
            project = arg.slice('--project='.length)
            if (!project) error(`--project requires a value\n\n${WEBAPP_USAGE}`)
            continue
        }
        if (arg === '--port') {
            port = Number(readRequiredValue(argv, index, '--port'))
            index += 1
            continue
        }
        if (arg.startsWith('--port=')) {
            port = Number(arg.slice('--port='.length))
            continue
        }
        if (arg === '--no-open') {
            open = false
            continue
        }
        error(`unknown argument: ${arg}\n\n${WEBAPP_USAGE}`)
    }

    if (!project) error(`missing required --project <path>\n\n${WEBAPP_USAGE}`)
    if (!Number.isInteger(port) || port <= 0) error(`--port must be a positive integer\n\n${WEBAPP_USAGE}`)

    return {project: resolve(project), port, open, lan}
}

// First non-internal IPv4 address — this machine's LAN IP, used in --lan mode so
// the renderer (and any LAN device loading it) reaches VTD at a routable address
// rather than 127.0.0.1. Errors out if the machine is offline / has no LAN IPv4.
function resolveLanIPv4(): string {
    for (const addrs of Object.values(networkInterfaces())) {
        for (const addr of addrs ?? []) {
            if (addr.family === 'IPv4' && !addr.internal) return addr.address
        }
    }
    error('vt webapp --lan: could not determine this machine\'s LAN IPv4 address (offline?)')
}

// Rewrite only the host of a URL, preserving protocol + port.
function withHost(url: string, host: string): string {
    const parsed: URL = new URL(url)
    return `${parsed.protocol}//${host}:${parsed.port}`
}

// CORS must be configured BEFORE the ensure spawns vt-daemon, so a freshly
// launched daemon accepts the browser dev origin. A daemon that is merely
// reused keeps its existing CORS — hence the reuse note printed below.
function applyDevCorsOrigins(port: number, lanIp: string | null): void {
    const origins: string[] = [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
    // In --lan mode the page is also loaded from this machine's LAN IP (on the
    // phone/tablet), so that origin must pass VTD's CORS gate too.
    if (lanIp) origins.push(`http://${lanIp}:${port}`)
    const devOrigins: string = origins.join(',')
    const existing: string | undefined = process.env.VOICETREE_CORS_ORIGINS
    process.env.VOICETREE_CORS_ORIGINS = existing ? `${existing},${devOrigins}` : devOrigins
}

function resolveViteBin(): string {
    const candidates: readonly string[] = [
        resolve(WEBAPP_DIR, 'node_modules/.bin/vite'),
        resolve(REPO_ROOT, 'node_modules/.bin/vite'),
    ]
    for (const candidate of candidates) if (existsSync(candidate)) return candidate
    error('vt webapp: vite binary not found — run from a monorepo checkout with deps installed')
}

function openInBrowser(url: string): void {
    let cmd: string
    let cmdArgs: string[]
    if (process.platform === 'darwin') {
        cmd = 'open'
        cmdArgs = [url]
    } else if (process.platform === 'win32') {
        cmd = 'cmd'
        cmdArgs = ['/c', 'start', '', url]
    } else {
        cmd = 'xdg-open'
        cmdArgs = [url]
    }
    try {
        spawn(cmd, cmdArgs, {stdio: 'ignore', detached: true}).unref()
    } catch {
        // Best-effort: a missing platform opener must not bring down the dev server.
    }
}

// Poll until the dev server answers (any HTTP response means it's listening),
// so the browser opens on a ready page rather than a connection-refused error.
async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
    const deadline: number = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            await fetch(url)
            return true
        } catch {
            await new Promise<void>((r) => setTimeout(r, 250))
        }
    }
    return false
}

export async function runWebappCommand(argv: string[]): Promise<void> {
    const args: WebappArgs = parseWebappArgs(argv)

    if (!existsSync(resolve(WEBAPP_DIR, 'package.json'))) {
        error('vt webapp is only available in a monorepo checkout (webapp/ not found)')
    }
    const viteBin: string = resolveViteBin()

    const lanIp: string | null = args.lan ? resolveLanIPv4() : null
    applyDevCorsOrigins(args.port, lanIp)

    const {graphd, vtd}: EnsuredDaemons = await ensureBothDaemons(args.project, {exclusive: false})
    const vtdUrl: string = vtd.client.baseUrl
    // The renderer (served to every client, including LAN devices) must reach VTD
    // at a routable address. In --lan mode that's this machine's LAN IP, not 127.0.0.1.
    const clientVtdUrl: string = lanIp ? withHost(vtdUrl, lanIp) : vtdUrl
    const webUrl: string = `http://localhost:${args.port}`
    const lanUrl: string | null = lanIp ? `http://${lanIp}:${args.port}` : null

    process.stdout.write(
        `vt webapp: vt-daemon on ${vtdUrl} (pid ${vtd.pid}), `
        + `graph-db on http://127.0.0.1:${graphd.port} (loopback-internal), project=${args.project}\n`
        + `Serving webapp → ${webUrl}\n`
        + (lanUrl ? `LAN mode: open on another device on this network → ${lanUrl} (renderer → VTD at ${clientVtdUrl})\n` : ''),
    )
    if (!vtd.launched) {
        process.stdout.write(
            'note: reused an already-running vt-daemon. If the browser shows CORS errors, stop it and '
            + `rerun — its VOICETREE_CORS_ORIGINS must include ${lanUrl ?? webUrl}.\n`,
        )
    }

    const viteArgs: string[] = ['--port', String(args.port), '--strictPort']
    // --host binds vite to 0.0.0.0 so LAN devices can load the page; without it
    // vite listens on localhost only.
    if (args.lan) viteArgs.push('--host')
    const vite: ChildProcess = spawn(
        viteBin,
        viteArgs,
        {cwd: WEBAPP_DIR, stdio: 'inherit', env: {...process.env, VITE_VTD_URL: clientVtdUrl}},
    )

    const stopVite = (): void => {
        if (vite.exitCode === null && !vite.killed) vite.kill('SIGTERM')
    }
    const onSignal = (): void => {
        stopVite()
        process.exit(0)
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    if (args.open) {
        void waitForHttp(webUrl, 30_000).then((up) => {
            if (up) openInBrowser(webUrl)
        })
    }

    // Stay in the foreground for as long as the dev server runs. The daemons
    // are cross-process shared resources and are left running on exit.
    await new Promise<void>((resolveWhenDone) => {
        vite.once('exit', (code) => {
            process.stdout.write(
                `\nvite dev server exited (code ${code ?? 'signal'}). Daemons left running.\n`,
            )
            resolveWhenDone()
        })
        vite.once('error', (err) => {
            process.stdout.write(`\nfailed to start vite: ${(err as Error).message}\n`)
            resolveWhenDone()
        })
    })
}
