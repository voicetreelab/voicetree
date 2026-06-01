import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { listLiveInstances, pickInstance, type DebugInstance, type PickOpts, type PickResult } from './discover'

function findRepoRoot(startDir: string): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      // The repo root has a `webapp/` subdir; package subdirs do not.
      if (existsSync(path.join(dir, 'webapp', 'package.json'))) return dir
    }
    dir = path.dirname(dir)
  }
  throw new Error(`REPO_ROOT: workspace root not found from ${startDir}`)
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
const AUTO_LAUNCH_TIMEOUT_MS = 30_000
const AUTO_LAUNCH_POLL_MS = 250
export const CDP_LOOPBACK_HOST = '127.0.0.1'

export function formatCdpHttpEndpoint(port: number): string {
  return `http://${CDP_LOOPBACK_HOST}:${port}`
}

export type LaunchedChild = {
  exited: boolean
  exitCode: number | null
  logPath?: string
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
    const response = await fetch(`${formatCdpHttpEndpoint(port)}/json/version`, {
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
  const logDir = path.join(os.tmpdir(), 'vt-debug-electron')
  mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, `${port}.log`)
  const logFd = openSync(logPath, 'a')
  const handle: LaunchedChild = { exited: false, exitCode: null, logPath, output: [] }
  let logFdClosed = false

  const closeLogFd = () => {
    if (logFdClosed) return
    logFdClosed = true
    closeSync(logFd)
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['--prefix', 'webapp', 'run', 'electron:debug'],
      {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...process.env,
          ENABLE_PLAYWRIGHT_DEBUG: '1',
          PLAYWRIGHT_MCP_CDP_ENDPOINT: formatCdpHttpEndpoint(port),
          VT_DEBUG_AUTOLAUNCHED: '1',
        },
      },
    )

    child.once('close', (code) => {
      handle.exited = true
      handle.exitCode = code
    })

    child.once('error', (error) => {
      closeLogFd()
      reject(error)
    })
    child.once('spawn', () => {
      child.unref()
      closeLogFd()
      resolve()
    })
  })

  return handle
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function readLaunchOutputTail(child: LaunchedChild): string {
  if (child.logPath && existsSync(child.logPath)) {
    try {
      return readFileSync(child.logPath, 'utf8')
        .split('\n')
        .slice(-MAX_OUTPUT_LINES)
        .join('\n')
        .trim()
    } catch {
      // Fall through to in-memory output from injected test doubles.
    }
  }

  return child.output.join('\n')
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
      const output = readLaunchOutputTail(child)
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

  const output = readLaunchOutputTail(child)
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
    opts.project !== undefined

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
        hint: pick.instance.cdpPort === 0
          ? 'CDP was not enabled for this session — restart the app (it auto-enables CDP for unpackaged builds)'
          : 'wait for startup to finish or pick a different dev session with vt-debug ls',
      }
    }

    return pick
  }

  if (!opts.forceNew && instances.length >= 1) {
    const allCdpZero = instances.every(i => i.cdpPort === 0)
    return {
      ok: false,
      message: `existing dev session${instances.length > 1 ? 's' : ''} found (${formatPortList(instances)})`,
      hint: allCdpZero
        ? 'all sessions have cdpPort=0 (CDP was not enabled). Re-run with --new to launch a fresh session with CDP'
        : `re-run with --port ${instances[0].cdpPort} to reuse, or --new to launch a fresh session (preferred if testing new code)`,
      instances,
    }
  }

  const port = await resolvedDeps.allocatePort()
  const child = await resolvedDeps.launchDevSession(port)
  return waitForAutoLaunchedInstance(port, child, resolvedDeps)
}
