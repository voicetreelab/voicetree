import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { listLiveInstances, pickInstance, type DebugInstance, type PickOpts, type PickResult } from './discover'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const AUTO_LAUNCH_TIMEOUT_MS = 30_000
const AUTO_LAUNCH_POLL_MS = 250

export type LaunchedChild = {
  exited: boolean
  exitCode: number | null
  output: string[]
}

export type ResolveDebugInstanceDeps = {
  allocatePort?: () => Promise<number>
  launchDevSession?: (port: number) => Promise<LaunchedChild>
  listInstances?: () => Promise<DebugInstance[]>
  now?: () => number
  probeCdpPort?: (port: number) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  stderr?: Pick<NodeJS.WriteStream, 'write'>
}

export async function probeCdpPort(port: number): Promise<boolean> {
  if (!Number.isFinite(port) || port <= 0) {
    return false
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_500)

  try {
    const response = await fetch(`http://localhost:${port}/json/version`, {
      signal: controller.signal,
    })

    if (!response.ok) {
      return false
    }

    const payload = await response.json() as Record<string, unknown>
    return (
      typeof payload.Browser === 'string' &&
      typeof payload.webSocketDebuggerUrl === 'string' &&
      payload.webSocketDebuggerUrl.length > 0
    )
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('unable to determine free localhost port')))
        return
      }

      const { port } = address
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

const MAX_OUTPUT_LINES = 50

async function launchDevSession(port: number): Promise<LaunchedChild> {
  const handle: LaunchedChild = { exited: false, exitCode: null, output: [] }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['--prefix', 'webapp', 'run', 'electron:debug'],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ENABLE_PLAYWRIGHT_DEBUG: '1',
          PLAYWRIGHT_MCP_CDP_ENDPOINT: `http://localhost:${port}`,
          VT_DEBUG_AUTOLAUNCHED: '1',
        },
      },
    )

    const collectLine = (line: string) => {
      handle.output.push(line)
      if (handle.output.length > MAX_OUTPUT_LINES) {
        handle.output.shift()
      }
    }

    let stdoutRemainder = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      const text = stdoutRemainder + chunk.toString()
      const lines = text.split('\n')
      stdoutRemainder = lines.pop() ?? ''
      for (const line of lines) collectLine(line)
    })

    let stderrRemainder = ''
    child.stderr!.on('data', (chunk: Buffer) => {
      const text = stderrRemainder + chunk.toString()
      const lines = text.split('\n')
      stderrRemainder = lines.pop() ?? ''
      for (const line of lines) collectLine(line)
    })

    child.once('close', (code) => {
      if (stdoutRemainder) collectLine(stdoutRemainder)
      if (stderrRemainder) collectLine(stderrRemainder)
      handle.exited = true
      handle.exitCode = code
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

  return handle
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function formatPortList(instances: readonly DebugInstance[]): string {
  return instances
    .map(instance => String(instance.cdpPort))
    .join(', ')
}

async function isInspectableInstance(
  instance: DebugInstance,
  probe: (port: number) => Promise<boolean>,
): Promise<boolean> {
  return instance.cdpPort > 0 && await probe(instance.cdpPort)
}

function singleInstanceUnavailable(instance: DebugInstance): PickResult {
  return {
    ok: false,
    message: `single dev instance found but its CDP endpoint is unavailable (cdp=${instance.cdpPort})`,
    hint: 'wait for startup to finish or re-run with --port once the dev session is ready',
  }
}

async function waitForAutoLaunchedInstance(
  port: number,
  child: LaunchedChild,
  deps: Required<ResolveDebugInstanceDeps>,
): Promise<PickResult> {
  const deadline = deps.now() + AUTO_LAUNCH_TIMEOUT_MS

  while (deps.now() <= deadline) {
    if (child.exited) {
      const output = child.output.join('\n')
      return {
        ok: false,
        message: `auto-launched dev session exited with code ${child.exitCode ?? 'unknown'}`,
        hint: output.length > 0
          ? `captured output:\n${output}`
          : 'no output captured — the process may have crashed immediately',
      }
    }

    const instances = await deps.listInstances()
    const candidate = instances.find(instance => instance.cdpPort === port)
    if (candidate && await isInspectableInstance(candidate, deps.probeCdpPort)) {
      deps.stderr.write(
        `[vt-debug] launched new dev session on port ${port} — re-run with --port ${port} for future commands\n`,
      )
      return { ok: true, instance: candidate }
    }

    await deps.sleep(AUTO_LAUNCH_POLL_MS)
  }

  const output = child.output.join('\n')
  return {
    ok: false,
    message: `timed out waiting for auto-launched dev session on port ${port} to register`,
    hint: output.length > 0
      ? `captured output (may reveal the issue):\n${output}`
      : 'run vt-debug ls to inspect registered dev sessions',
  }
}

export async function resolveDebugInstance(
  opts: PickOpts = {},
  deps: ResolveDebugInstanceDeps = {},
): Promise<PickResult> {
  const resolvedDeps: Required<ResolveDebugInstanceDeps> = {
    allocatePort: deps.allocatePort ?? allocatePort,
    launchDevSession: deps.launchDevSession ?? launchDevSession,
    listInstances: deps.listInstances ?? (() => listLiveInstances()),
    now: deps.now ?? (() => Date.now()),
    probeCdpPort: deps.probeCdpPort ?? probeCdpPort,
    sleep: deps.sleep ?? sleep,
    stderr: deps.stderr ?? process.stderr,
  }

  const hasExplicitSelector =
    opts.port !== undefined ||
    opts.pid !== undefined ||
    opts.vault !== undefined

  const instances = await resolvedDeps.listInstances()

  if (hasExplicitSelector) {
    const pick = pickInstance(instances, opts)
    if (!pick.ok) {
      return pick
    }

    if (!await isInspectableInstance(pick.instance, resolvedDeps.probeCdpPort)) {
      return {
        ok: false,
        message: `selected dev instance is not ready for CDP attach (cdp=${pick.instance.cdpPort})`,
        hint: 'wait for startup to finish or pick a different dev session with vt-debug ls',
      }
    }

    return pick
  }

  if (!opts.forceNew && instances.length >= 1) {
    return {
      ok: false,
      message: `existing dev session${instances.length > 1 ? 's' : ''} found (${formatPortList(instances)})`,
      hint: `re-run with --port ${instances[0].cdpPort} to reuse, or --new to launch a fresh session (preferred if testing new code)`,
      instances,
    }
  }

  const port = await resolvedDeps.allocatePort()
  const child = await resolvedDeps.launchDevSession(port)
  return waitForAutoLaunchedInstance(port, child, resolvedDeps)
}
