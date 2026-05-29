import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/app-config/paths'

export interface OrphanCleanupResult {
  readonly killed: readonly { pid: number; vault: string }[]
  readonly skipped: readonly { pid: number; vault: string; reason: string }[]
}

type OrphanProcessCandidate = {
  readonly pid: number
  readonly vault: string
}

type ProcessSignal = NodeJS.Signals | 0

type TerminateDaemonDeps = {
  delay: (ms: number) => Promise<void>
  isProcessAlive: (pid: number) => boolean
  isVtGraphdProcessForVault: (pid: number, vault: string) => boolean
  killProcess: (pid: number, signal: ProcessSignal) => void
  now: () => number
  unlinkFile: (path: string) => Promise<void>
}

type OrphanCleanupDeps = {
  currentPid: number
  killProcess: (pid: number, signal: ProcessSignal) => void
  listProcesses: () => readonly string[] | null
  platform: NodeJS.Platform
  vaultExists: (vault: string) => boolean
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return false
  }
}

function readPidCommandLine(pid: number): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    timeout: 2000,
  })
  if (result.status !== 0 || !result.stdout) return null
  return result.stdout.trim()
}

function killProcess(pid: number, signal: ProcessSignal): void {
  process.kill(pid, signal)
}

function nowMs(): number {
  return Date.now()
}

async function unlinkFile(path: string): Promise<void> {
  await unlink(path)
}

/**
 * True when pid's command-line is a `vt-graphd` invocation whose `--project-root`
 * argument resolves to `vault`. Used as a safety check before SIGTERM-ing a
 * pid recovered from a lockfile we don't trust.
 */
export function isVtGraphdProcessForVault(pid: number, vault: string): boolean {
  const cmd = readPidCommandLine(pid)
  if (!cmd) return false
  const match = /\bvt-graphd\.\w+\b.*--project-root\s+(\S+)/.exec(cmd)
  if (!match) return false
  return resolve(match[1]) === resolve(vault)
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

async function waitForProcessExit(
  pid: number,
  deadline: number,
  deps: Pick<TerminateDaemonDeps, 'delay' | 'isProcessAlive' | 'now'>,
): Promise<void> {
  while (deps.now() < deadline && deps.isProcessAlive(pid)) {
    await deps.delay(50)
  }
}

async function removeDaemonFiles(
  resolvedVault: string,
  deps: Pick<TerminateDaemonDeps, 'unlinkFile'>,
): Promise<void> {
  const dotDir = getProjectDotVoicetreePath(resolvedVault)
  await deps.unlinkFile(join(dotDir, 'graphd.lock')).catch(() => undefined)
  await deps.unlinkFile(join(dotDir, 'graphd.port')).catch(() => undefined)
}

/**
 * Terminate a vt-graphd process holding the lock for a vault and clean up its
 * stale lock + port files. Refuses to kill a pid whose command-line doesn't
 * match `vt-graphd ... --project-root <vault>` — the lockfile contents are
 * untrusted, so we verify before killing.
 *
 * Returns true when the process was terminated (or already dead) and lock /
 * port files were removed; false if the safety check rejected the pid.
 */
export async function terminateUnresponsiveDaemon(
  vault: string,
  pid: number,
  opts?: { gracePeriodMs?: number },
  deps: TerminateDaemonDeps = {
    delay,
    isProcessAlive,
    isVtGraphdProcessForVault,
    killProcess,
    now: nowMs,
    unlinkFile,
  },
): Promise<boolean> {
  const resolvedVault = resolve(vault)
  const gracePeriodMs = opts?.gracePeriodMs ?? 2000

  if (
    deps.isProcessAlive(pid)
    && !deps.isVtGraphdProcessForVault(pid, resolvedVault)
  ) {
    return false
  }

  if (deps.isProcessAlive(pid)) {
    try {
      deps.killProcess(pid, 'SIGTERM')
    } catch {
      // already gone
    }

    const deadline = deps.now() + gracePeriodMs
    await waitForProcessExit(pid, deadline, deps)

    if (deps.isProcessAlive(pid)) {
      try {
        deps.killProcess(pid, 'SIGKILL')
      } catch {
        // already gone
      }
      await deps.delay(100)
    }
  }

  await removeDaemonFiles(resolvedVault, deps)
  return true
}

function isSupportedOrphanCleanupPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'linux'
}

function listProcessLines(): readonly string[] | null {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0 || !result.stdout) {
    return null
  }
  return result.stdout.split('\n')
}

function vaultExists(vault: string): boolean {
  try {
    return statSync(vault).isDirectory()
  } catch {
    return false
  }
}

function parseVtGraphdProcessLine(line: string): OrphanProcessCandidate | null {
  const matcher = /^\s*(\d+)\s+\d+\s+(.*\bvt-graphd\.\w+\b.*--project-root\s+(\S+).*)$/
  const match = matcher.exec(line)
  if (!match) return null
  const pid = Number(match[1])
  if (!Number.isFinite(pid)) return null
  return { pid, vault: match[3] }
}

function findOrphanCandidates(
  lines: readonly string[],
  deps: Pick<OrphanCleanupDeps, 'currentPid' | 'vaultExists'>,
): {
  candidates: OrphanProcessCandidate[]
  skipped: { pid: number; vault: string; reason: string }[]
} {
  const candidates: OrphanProcessCandidate[] = []
  const skipped: { pid: number; vault: string; reason: string }[] = []

  for (const line of lines) {
    const vaultBound = parseVtGraphdProcessLine(line)
    if (!vaultBound || vaultBound.pid === deps.currentPid) continue
    if (deps.vaultExists(vaultBound.vault)) {
      skipped.push({
        pid: vaultBound.pid,
        reason: 'vault-exists',
        vault: vaultBound.vault,
      })
    } else {
      candidates.push(vaultBound)
    }
  }

  return { candidates, skipped }
}

/**
 * Find vt-graphd processes whose --project-root argument no longer points to an
 * existing directory and terminate them. These are leftover daemons from
 * crashed apps or aborted test runs; they hold ports and contend with the
 * fresh daemon a current load is trying to reach.
 *
 * Only matches daemons launched via the `vt-graphd` entry; only
 * kills processes whose vault path is missing on disk. POSIX-only (macOS,
 * Linux); no-op on other platforms.
 */
export function killOrphanVtGraphdDaemons(
  deps: OrphanCleanupDeps = {
    currentPid: process.pid,
    killProcess,
    listProcesses: listProcessLines,
    platform: process.platform,
    vaultExists,
  },
): OrphanCleanupResult {
  const killed: { pid: number; vault: string }[] = []
  const skipped: { pid: number; vault: string; reason: string }[] = []

  if (!isSupportedOrphanCleanupPlatform(deps.platform)) {
    return { killed, skipped }
  }

  const lines = deps.listProcesses()
  if (lines === null) {
    return { killed, skipped }
  }

  const orphanScan = findOrphanCandidates(lines, deps)
  skipped.push(...orphanScan.skipped)

  for (const { pid, vault } of orphanScan.candidates) {
    try {
      deps.killProcess(pid, 'SIGTERM')
      killed.push({ pid, vault })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'kill-failed'
      skipped.push({ pid, vault, reason })
    }
  }

  return { killed, skipped }
}
