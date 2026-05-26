/**
 * Process liveness and command-fingerprint inspection for the recorded
 * owner pid. Both observations feed {@link decideOwnerAction} as evidence
 * about whether the recorded owner is still the live vt-graphd it claims
 * to be.
 *
 * POSIX (macOS/Linux) inspect commands via `ps`; other platforms return
 * `'unknown'`, which the decision policy treats conservatively (no kill).
 */

import { spawnSync } from 'node:child_process'
import type { CommandFingerprint } from '../types.ts'
import type {
  CommandFingerprintMatch,
  ProcessLiveness,
} from '../ownership/ownerDecision.ts'

export function readProcessLiveness(pid: number): ProcessLiveness {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return 'dead'
    // EPERM and other access-denied errors mean the pid exists but we
    // cannot inspect it. Treat as unknown so reclaim is never authorised.
    return 'unknown'
  }
}

/**
 * Inspect the live command for a pid and compare it to the recorded
 * fingerprint. Returns:
 * - `'match'` when executable + args line up exactly.
 * - `'mismatch'` when a comparable command was read but disagrees.
 * - `'unknown'` when the platform cannot be inspected or `ps` is silent —
 *   the conservative branch that refuses to authorise a kill.
 */
export function readCommandFingerprintMatch(
  pid: number,
  recorded: CommandFingerprint,
): CommandFingerprintMatch {
  const live = readPidCommand(pid)
  if (live === null) return 'unknown'
  return fingerprintsEqual(live, recorded) ? 'match' : 'mismatch'
}

function fingerprintsEqual(
  a: CommandFingerprint,
  b: CommandFingerprint,
): boolean {
  if (a.executable !== b.executable) return false
  if (a.args.length !== b.args.length) return false
  for (let i = 0; i < a.args.length; i++) {
    if (a.args[i] !== b.args[i]) return false
  }
  return true
}

function readPidCommand(pid: number): CommandFingerprint | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    timeout: 2000,
  })
  if (result.status !== 0 || !result.stdout) return null
  const tokens = result.stdout.trim().split(/\s+/)
  if (tokens.length === 0 || tokens[0] === '') return null
  return { executable: tokens[0], args: tokens.slice(1) }
}
