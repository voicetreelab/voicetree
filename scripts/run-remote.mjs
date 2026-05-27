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
// Two mutagen sessions back this script:
//   * `vt-remote`  — main checkout ↔ /root/voicetree-public  (one-way-replica)
//   * `vt-wts`     — sibling /Users/.../vt-wts/ ↔ /root/vt-wts/  (one-way-replica)
//
// Worktrees live SIBLING to the main checkout: `<parent>/vt-wts/<name>/`. The
// session is picked based on which root the cwd falls under. Blocks on the
// chosen session reaching `Status: Watching for changes` before invoking ssh.

import {readFileSync, existsSync} from 'node:fs'
import {spawn, execFile, execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname, resolve as pathResolve, relative as pathRelative, basename as pathBasename} from 'node:path'
import {posix as ppath} from 'node:path'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)
const REPO_ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..')
const REMOTE_ROOT = '/root/voicetree-public'
const REMOTE_WTS_ROOT = '/root/vt-wts'
const WORKTREE_SIBLING_DIR_NAME = 'vt-wts'
const MUTAGEN_SESSION_MAIN = 'vt-remote'
const MUTAGEN_SESSION_WTS = 'vt-wts'
const RECURSION_GUARD = 'VT_REMOTE_EXEC'

function loadEnvFile(p) {
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

function remoteHostFromEnvironment() {
  if (process.env.VT_REMOTE_HOST) return process.env.VT_REMOTE_HOST

  const candidateEnvFiles = [
    pathResolve(REPO_ROOT, '.env'),
    pathResolve(localMainCheckoutRoot(), '.env'),
  ]
  for (const envFile of [...new Set(candidateEnvFiles)]) {
    const host = loadEnvFile(envFile).VT_REMOTE_HOST
    if (host) return host
  }
  return null
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function localMainCheckoutRoot() {
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

function localWtsRoot(mainCheckoutRoot = localMainCheckoutRoot()) {
  return pathResolve(mainCheckoutRoot, '..', WORKTREE_SIBLING_DIR_NAME)
}

// Pick the sync session + roots that govern `cwd`.
//   - cwd inside `<main>/`             → vt-remote session, REMOTE_ROOT
//   - cwd inside `<parent>/vt-wts/`    → vt-wts session, REMOTE_WTS_ROOT
//   - cwd elsewhere                    → null (caller throws)
function resolveSyncContext(cwd = process.cwd()) {
  const mainCheckoutRoot = localMainCheckoutRoot()
  const wtsRoot = localWtsRoot(mainCheckoutRoot)

  if (!pathRelative(mainCheckoutRoot, cwd).startsWith('..')) {
    return {
      kind: 'main',
      session: MUTAGEN_SESSION_MAIN,
      localRoot: mainCheckoutRoot,
      remoteRoot: REMOTE_ROOT,
    }
  }
  if (!pathRelative(wtsRoot, cwd).startsWith('..')) {
    return {
      kind: 'worktree',
      session: MUTAGEN_SESSION_WTS,
      localRoot: wtsRoot,
      remoteRoot: REMOTE_WTS_ROOT,
    }
  }
  return null
}

function localWorktreeName(cwd, wtsRoot) {
  const rel = pathRelative(wtsRoot, cwd)
  const parts = rel.split(/[\\/]/)
  if (parts.length === 0 || !parts[0] || parts[0].startsWith('..')) return null
  return parts[0]
}

function repairLocalWorktreeMetadataIfNeeded({cwd = process.cwd()} = {}) {
  const mainCheckoutRoot = localMainCheckoutRoot()
  const wtsRoot = localWtsRoot(mainCheckoutRoot)
  const worktreeName = localWorktreeName(cwd, wtsRoot)
  if (worktreeName === null) return false
  const worktreeRoot = pathResolve(wtsRoot, worktreeName)
  process.stderr.write(`[run-remote] repairing local worktree git metadata before sync: ${worktreeRoot}\n`)
  execFileSync('git', ['-C', mainCheckoutRoot, 'worktree', 'repair', '--relative-paths'], {
    stdio: 'ignore',
  })
  return true
}

function runLocal(cmd, args) {
  const child = spawn(cmd, args, {stdio: 'inherit'})
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

async function waitMutagenIdle(session, {timeoutMs = 60_000} = {}) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = 'unknown'
  while (Date.now() < deadline) {
    let stdout
    try {
      ;({stdout} = await execFileAsync('mutagen', ['sync', 'list', '-l', session]))
    } catch (e) {
      const msg = (e.stderr || e.message || '').toString().trim()
      throw new Error(
        `mutagen sync list ${session} failed: ${msg}\n` +
          `Hint: create the sync session before using VT_REMOTE_HOST.`,
      )
    }
    const m = stdout.match(/^Status:\s*(.+)$/m)
    lastStatus = m ? m[1].trim() : 'unknown'
    if (lastStatus === 'Watching for changes') return stdout
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(
    `mutagen '${session}' did not reach idle within ${timeoutMs}ms (last status: ${lastStatus})`,
  )
}

function synchronizationMode(mutagenListOutput) {
  const match = mutagenListOutput.match(/^\s*Synchronization mode:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

function assertOneWayReplica(session, mutagenListOutput) {
  const mode = synchronizationMode(mutagenListOutput)
  if (mode !== null && /\bOne Way Replica\b/i.test(mode)) return
  throw new Error(
    `mutagen '${session}' must be one-way-replica before remote execution` +
      (mode === null ? '' : ` (current mode: ${mode})`) +
      `.\nHint: recreate the session from scripts/dev-setup/remote/.`,
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

// On remote, cwd is either `/root/voicetree-public/...` (main) or
// `/root/vt-wts/<name>/...` (worktree). The latter is the only case the
// worktree-ready / metadata-repair helpers care about.
function remoteWorktreeRoot(remoteCwd) {
  const rel = ppath.relative(REMOTE_WTS_ROOT, remoteCwd)
  if (rel.startsWith('..')) return null
  const parts = rel.split('/')
  if (!parts[0]) return null
  return ppath.join(REMOTE_WTS_ROOT, parts[0])
}

function ensureRemoteWorktreeReadyScript(remoteCwd) {
  const worktreeRoot = remoteWorktreeRoot(remoteCwd)
  if (worktreeRoot === null) return ':'
  const readyScript = ppath.join(REMOTE_ROOT, 'scripts/git/worktree/ensure-ready.mjs')
  return `node ${shq(readyScript)} ${shq(worktreeRoot)}`
}

function repairRemoteWorktreeMetadataScript(remoteCwd) {
  const worktreeRoot = remoteWorktreeRoot(remoteCwd)
  if (worktreeRoot === null) return ':'

  const worktreeName = ppath.basename(worktreeRoot)
  const mainRepoDirName = ppath.basename(REMOTE_ROOT)
  const adminDir = ppath.join(REMOTE_ROOT, '.git', 'worktrees', worktreeName)
  const worktreeGitFile = ppath.join(worktreeRoot, '.git')
  const adminGitdirFile = ppath.join(adminDir, 'gitdir')
  const adminCommondirFile = ppath.join(adminDir, 'commondir')

  // Sibling layout relative paths:
  //   <wts>/<name>/.git           → gitdir: ../../<mainRepoDirName>/.git/worktrees/<name>
  //   <main>/.git/worktrees/<name>/gitdir → ../../../../<WTS_BASENAME>/<name>/.git
  //   commondir from admin → main .git is `../..`
  const wtsBasename = ppath.basename(REMOTE_WTS_ROOT)
  return [
    `if [ -d ${shq(adminDir)} ] && [ -f ${shq(worktreeGitFile)} ]; then`,
    `echo ${shq(`[run-remote] repairing remote worktree git metadata: ${worktreeRoot}`)} >&2;`,
    `printf '%s\\n' ${shq(`gitdir: ../../${mainRepoDirName}/.git/worktrees/${worktreeName}`)} > ${shq(worktreeGitFile)};`,
    `printf '%s\\n' ${shq(`../../../../${wtsBasename}/${worktreeName}/.git`)} > ${shq(adminGitdirFile)};`,
    `printf '%s\\n' '../..' > ${shq(adminCommondirFile)};`,
    'fi',
  ].join(' ')
}

function runRemote(host, cmd, args, syncContext) {
  const {localRoot, remoteRoot} = syncContext
  const rel = pathRelative(localRoot, process.cwd())
  if (rel.startsWith('..')) {
    throw new Error(`cwd ${process.cwd()} is outside sync root ${localRoot}; cannot map to remote path`)
  }
  const remoteCwd = ppath.join(remoteRoot, rel.split(/[\\/]/).join('/'))
  const quotedCmd = [cmd, ...args].map(shq).join(' ')
  const remoteScript = [
    repairRemoteWorktreeMetadataScript(remoteCwd),
    `cd ${shq(remoteCwd)}`,
    refreshRemoteGitIndexScript(),
    ensureRemoteWorktreeReadyScript(remoteCwd),
    `export ${RECURSION_GUARD}=1`,
    `exec ${quotedCmd}`,
  ].join(' && ')

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

  const host = remoteHostFromEnvironment()
  if (!host) {
    runLocal(cmd, args)
    return
  }

  const syncContext = resolveSyncContext()
  if (syncContext === null) {
    throw new Error(
      `cwd ${process.cwd()} is outside both the main checkout and ${WORKTREE_SIBLING_DIR_NAME}/; cannot route to remote.`,
    )
  }
  process.stderr.write(`[run-remote] routing to ${host} via '${syncContext.session}' (waiting for mutagen idle…)\n`)
  repairLocalWorktreeMetadataIfNeeded()
  const mutagenListOutput = await waitMutagenIdle(syncContext.session)
  assertOneWayReplica(syncContext.session, mutagenListOutput)
  process.stderr.write(`[run-remote] mutagen idle + one-way replica; ssh ${host}\n`)
  runRemote(host, cmd, args, syncContext)
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
  ensureRemoteWorktreeReadyScript,
  repairRemoteWorktreeMetadataScript,
  repairLocalWorktreeMetadataIfNeeded,
  refreshRemoteGitIndexScript,
  remoteHostFromEnvironment,
  resolveSyncContext,
  localMainCheckoutRoot,
  localWtsRoot,
  localWorktreeName,
  remoteWorktreeRoot,
  synchronizationMode,
}
