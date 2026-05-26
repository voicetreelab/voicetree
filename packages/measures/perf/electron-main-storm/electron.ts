import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * Spawn the prebuilt electron app with `--inspect=0` and capture the inspect
 * port from stderr. Returns once Node has emitted the `Debugger listening` line.
 */
export async function spawnElectron(args: {
    electronBinary: string
    mainEntry: string
    userDataDir: string
    openFolder: string
    bootTimeoutMs: number
}): Promise<{ proc: ChildProcessWithoutNullStreams; inspectPort: number }> {
    // Linux dev boxes (Onidel) run as root and have no X server; mirror the
    // flag set used by webapp's e2e specs (no-sandbox + swiftshader + dev-shm).
    // On macOS none of these are needed.
    const linuxFlags = process.platform === 'linux'
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : []
    const proc = spawn(
        args.electronBinary,
        [
            '--inspect=0',
            ...linuxFlags,
            args.mainEntry,
            `--user-data-dir=${args.userDataDir}`,
            // --open-folder bypasses the project-picker UI and tells main to
            // open this vault directly on launch (see environment-config.ts).
            '--open-folder', args.openFolder,
        ],
        {
            env: {
                ...process.env,
                NODE_ENV: 'test',
                VOICETREE_PERSIST_STATE: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    ) as ChildProcessWithoutNullStreams

    const inspectPort = await new Promise<number>((resolveP, rejectP) => {
        const timeout = setTimeout(
            () => rejectP(new Error(`timed out waiting for --inspect port after ${args.bootTimeoutMs}ms`)),
            args.bootTimeoutMs,
        )
        let stderrBuf = ''
        proc.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            stderrBuf += text
            // Echo electron stderr to our stderr so boot errors are visible.
            process.stderr.write(`[electron] ${text}`)
            const match = stderrBuf.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
            if (match) {
                clearTimeout(timeout)
                resolveP(Number.parseInt(match[1], 10))
            }
        })
        proc.on('error', (err) => { clearTimeout(timeout); rejectP(err) })
        proc.on('exit', (code, signal) => {
            clearTimeout(timeout)
            rejectP(new Error(`electron exited before inspect port appeared (code=${code} signal=${signal})`))
        })
    })

    // Continue echoing electron stdout for visibility, but stop accumulating.
    proc.stdout.on('data', (chunk: Buffer) => {
        process.stderr.write(`[electron] ${chunk.toString()}`)
    })
    return { proc, inspectPort }
}

/**
 * Poll `<vault>/.mcp.json` for the voicetree MCP port. This file is written by
 * the electron app once its in-process MCP server has bound a port.
 */
export async function waitForMcpPort(vault: string, timeoutMs: number): Promise<number> {
    const mcpPath = join(vault, '.mcp.json')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (existsSync(mcpPath)) {
            try {
                const raw = readFileSync(mcpPath, 'utf8')
                const cfg = JSON.parse(raw) as {
                    mcpServers?: Record<string, { url?: string }>
                }
                const url = cfg.mcpServers?.voicetree?.url
                if (url) {
                    const m = url.match(/:(\d+)\/mcp$/)
                    if (m) return Number.parseInt(m[1], 10)
                }
            } catch {
                // file may be mid-write; retry
            }
        }
        await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`timed out waiting for ${mcpPath} after ${timeoutMs}ms`)
}

export async function stopElectron(proc: ChildProcessWithoutNullStreams): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill('SIGTERM')
    await new Promise<void>((resolveP) => {
        const force = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* */ } }, 5000)
        proc.on('exit', () => { clearTimeout(force); resolveP() })
    })
}
