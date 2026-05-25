#!/usr/bin/env node
// Run a command on the remote dev box if VT_REMOTE_HOST is set (in .env or
// the process env); otherwise run it locally. General-purpose: anything you
// can pass as argv works — `npm run test`, `vitest run x.test.ts`, `bash -c`,
// interactive REPLs, vim, etc. Stdio (incl. stdin) is fully piped through.
//
// Usage: node scripts/run-remote.mjs <cmd> [args...]
// Env:
//   VT_REMOTE_HOST   user@host of the dev box (e.g. root@209.38.31.40)
//   VT_REMOTE_EXEC=1 recursion guard: skip routing, just exec locally
//
// Assumes a one-way-replica mutagen sync session named `vt-remote` exists and
// maps the local main repo to /root/voicetree-public on the remote. Linked
// worktrees under `.worktrees/` are mapped to the matching remote worktree path.
// Blocks on the sync reaching `Status: Watching for changes` before invoking ssh.

import {readFileSync, existsSync} from 'node:fs'
import {spawn, execFile, execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname, resolve as pathResolve, relative as pathRelative} from 'node:path'
import {posix as ppath} from 'node:path'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)
const REPO_ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..')
const REMOTE_ROOT = '/root/voicetree-public'
const MUTAGEN_SESSION = 'vt-remote'
const RECURSION_GUARD = 'VT_REMOTE_EXEC'

function loadEnvFile() {
  const p = pathResolve(REPO_ROOT, '.env')
  if (!existsSync(p)) return {}
  const env = {}
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    env[m[1]] = v
  }
  return env
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function localSyncRoot() {
  try {
    const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
    return dirname(pathResolve(REPO_ROOT, commonDir))
  } catch {
    return REPO_ROOT
  }
}

function runLocal(cmd, args) {
  const child = spawn(cmd, args, {stdio: 'inherit'})
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

async function waitMutagenIdle({timeoutMs = 60_000} = {}) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'unknown'
  while (Date.now() < deadline) {
    let stdout
    try {
      ;({stdout} = await execFileAsync('mutagen', ['sync', 'list', '-l', MUTAGEN_SESSION]))
    } catch (e) {
      const msg = (e.stderr || e.message || '').toString().trim()
      throw new Error(
        `mutagen sync list ${MUTAGEN_SESSION} failed: ${msg}\n` +
          `Hint: create the sync session before using VT_REMOTE_HOST.`,
      )
    }
    const m = stdout.match(/^Status:\s*(.+)$/m)
    lastStatus = m ? m[1].trim() : 'unknown'
    if (lastStatus === 'Watching for changes') return stdout
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(
    `mutagen '${MUTAGEN_SESSION}' did not reach idle within ${timeoutMs}ms (last status: ${lastStatus})`,
  )
}

function synchronizationMode(mutagenListOutput) {
  const match = mutagenListOutput.match(/^\s*Synchronization mode:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

function assertOneWayReplica(mutagenListOutput) {
  const mode = synchronizationMode(mutagenListOutput)
  if (mode !== null && /\bOne Way Replica\b/i.test(mode)) return
  throw new Error(
    `mutagen '${MUTAGEN_SESSION}' must be one-way-replica before remote execution` +
      (mode === null ? '' : ` (current mode: ${mode})`) +
      `.\nHint: recreate vt-remote from get_dev_healthy/mutagen-vt-remote.yml.`,
  )
}

function refreshRemoteGitIndexScript() {
  return [
    'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    // The remote .git/index is intentionally not synced. Refresh it from HEAD
    // before tests so Git-dependent checks don't run against stale Beta state.
    'git reset --mixed -q HEAD;',
    'fi',
  ].join(' ')
}

function runRemote(host, cmd, args) {
  const syncRoot = localSyncRoot()
  const rel = pathRelative(syncRoot, process.cwd())
  if (rel.startsWith('..')) {
    throw new Error(`cwd ${process.cwd()} is outside sync root ${syncRoot}; cannot map to remote path`)
  }
  const remoteCwd = ppath.join(REMOTE_ROOT, rel.split(/[\\/]/).join('/'))
  const quotedCmd = [cmd, ...args].map(shq).join(' ')
  const remoteScript = `cd ${shq(remoteCwd)} && ${refreshRemoteGitIndexScript()} && export ${RECURSION_GUARD}=1 && exec ${quotedCmd}`

  // -tt allocates a TTY (needed for interactive commands, colors, signals).
  // -T disables it (needed when local stdin is piped, else TTY echo doubles output).
  const ttyFlag = process.stdin.isTTY ? '-tt' : '-T'
  const ssh = spawn('ssh', [ttyFlag, host, remoteScript], {stdio: 'inherit'})
  ssh.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    console.error('usage: run-remote.mjs <cmd> [args...]')
    process.exit(64)
  }
  const [cmd, ...args] = argv

  if (process.env[RECURSION_GUARD] === '1') {
    runLocal(cmd, args)
    return
  }

  const fileEnv = loadEnvFile()
  const host = process.env.VT_REMOTE_HOST || fileEnv.VT_REMOTE_HOST
  if (!host) {
    runLocal(cmd, args)
    return
  }

  process.stderr.write(`[run-remote] routing to ${host} (waiting for mutagen idle…)\n`)
  const mutagenListOutput = await waitMutagenIdle()
  assertOneWayReplica(mutagenListOutput)
  process.stderr.write(`[run-remote] mutagen idle + one-way replica; ssh ${host}\n`)
  runRemote(host, cmd, args)
}

const isDirectRun = process.argv[1] && pathResolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(err => {
    console.error(`[run-remote] ${err.message}`)
    process.exit(1)
  })
}

export {
  assertOneWayReplica,
  refreshRemoteGitIndexScript,
  synchronizationMode,
}
