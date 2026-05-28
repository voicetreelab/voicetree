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
//
// The remote .git/index IS synced (see mutagen-vt-remote.yml), so commands run
// here see the same staged tree as local git. This is what lets pre-commit
// route to the devbox without re-running checks against HEAD.

import {readFileSync, existsSync, readdirSync} from 'node:fs'
import {spawn, execFile, execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname, resolve as pathResolve, relative as pathRelative, basename} from 'node:path'
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
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      [RECURSION_GUARD]: '1',
    },
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

// Read the session details with a single `mutagen sync list -l` call. Pure
// wrapper around the impure command; returns stdout or throws if the session
// doesn't exist / mutagen isn't installed.
async function readMutagenSession(session) {
  try {
    const {stdout} = await execFileAsync('mutagen', ['sync', 'list', '-l', session])
    return stdout
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim()
    throw new Error(
      `mutagen sync list ${session} failed: ${msg}\n` +
        `Hint: create the sync session before using VT_REMOTE_HOST.`,
    )
  }
}

// Parse alpha/beta connection state. Pure: returns {alpha, beta, status}.
function parseSessionConnectivity(mutagenListOutput) {
  const alphaSection = mutagenListOutput.match(/^Alpha:[\s\S]*?(?=^Beta:|\Z)/m)
  const betaSection = mutagenListOutput.match(/^Beta:[\s\S]*?(?=^Conflicts:|^Status:|\Z)/m)
  const isConnected = section => /^\s*Connected:\s*Yes\s*$/m.test(section ?? '')
  const status = (mutagenListOutput.match(/^Status:\s*(.+)$/m)?.[1] || '').trim()
  return {
    alpha: isConnected(alphaSection?.[0]),
    beta: isConnected(betaSection?.[0]),
    status,
  }
}

// Reject sessions that can't move data right now. We do NOT require `Watching
// for changes` — under multi-agent load that quiet window may never come, and
// `mutagen sync flush` will drive the cycle to completion regardless. We only
// require the session is alive and both endpoints are connected.
function assertSessionAlive(session, mutagenListOutput) {
  const {alpha, beta, status} = parseSessionConnectivity(mutagenListOutput)
  if (/^\[?Paused\]?$/i.test(status)) {
    throw new Error(
      `mutagen '${session}' is paused.\n` +
        `Hint: run 'mutagen sync resume ${session}'.`,
    )
  }
  if (!alpha || !beta) {
    throw new Error(
      `mutagen '${session}' endpoint(s) disconnected ` +
        `(alpha=${alpha ? 'connected' : 'down'}, beta=${beta ? 'connected' : 'down'}, status=${status || 'unknown'}).\n` +
        `Hint: check network / recreate session from scripts/dev-setup/remote/.`,
    )
  }
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

// Force a single synchronization cycle and block until it completes. Unlike
// waiting for `Watching for changes`, this is bounded by the size of the
// CURRENT pending delta — peer agents adding more changes during/after the
// flush land in the NEXT cycle and do not delay this one.
async function flushMutagenSession(session) {
  try {
    await execFileAsync('mutagen', ['sync', 'flush', session])
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().trim()
    throw new Error(`mutagen sync flush ${session} failed: ${msg}`)
  }
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

// Inventory of worktree names known to the local repo.
//
// Union of `git worktree list` basenames and `ls .git/worktrees/`. The union
// is intentionally maximal so the stale-on-remote diff stays minimal —
// anything plausibly local must not be deleted on remote.
function localWorktreeNames(repoRoot = REPO_ROOT) {
  const names = new Set()
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {encoding: 'utf8'})
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) names.add(basename(line.slice('worktree '.length)))
    }
  } catch {
    // No git or not a repo — treat as empty; reconciler will skip.
  }
  try {
    for (const entry of readdirSync(pathResolve(repoRoot, '.git/worktrees'))) names.add(entry)
  } catch {
    // .git/worktrees missing (no linked worktrees) — empty set is fine.
  }
  return [...names]
}

// Shell snippet that prints the remote worktree inventory across BOTH roots:
// the main checkout's nested .worktrees/ (legacy) AND the sibling vt-wts/
// directory. Anything in either is considered "remote-known" for reconcile.
// Pure: returns a string. Caller is responsible for sending it over ssh.
function remoteWorktreeListingScript({remoteRoot = REMOTE_ROOT, remoteWtsRoot = REMOTE_WTS_ROOT} = {}) {
  return [
    'echo ===GIT===',
    `ls -1 ${shq(`${remoteRoot}/.git/worktrees`)} 2>/dev/null || true`,
    'echo ===WT===',
    `ls -1 ${shq(remoteWtsRoot)} 2>/dev/null || true`,
  ].join('; ')
}

// Parse the two-section listing produced by remoteWorktreeListingScript.
// Pure: returns {git, wt} string arrays.
function parseRemoteWorktreeListing(stdout) {
  const lines = stdout.split(/\r?\n/)
  const gitIdx = lines.indexOf('===GIT===')
  const wtIdx = lines.indexOf('===WT===')
  if (gitIdx < 0 || wtIdx < 0 || wtIdx < gitIdx) return {git: [], wt: []}
  const collect = (start, end) =>
    lines.slice(start, end).map(s => s.trim()).filter(s => s !== '')
  return {
    git: collect(gitIdx + 1, wtIdx),
    wt: collect(wtIdx + 1, lines.length),
  }
}

// Names present on remote but not local. Pure.
function computeStaleWorktreeNames({localNames, remoteNames}) {
  const local = new Set(localNames)
  return remoteNames.filter(n => !local.has(n)).sort()
}

// Build a shell snippet that removes the stale dirs on remote. Returns null
// when nothing needs to happen. Defensive: rejects names with shell-unsafe
// characters so we never feed unvalidated input into rm -rf. Pure.
function buildReconcileCleanupScript({
  staleGit,
  staleWt,
  remoteRoot = REMOTE_ROOT,
  remoteWtsRoot = REMOTE_WTS_ROOT,
}) {
  const safe = n => typeof n === 'string' && /^[A-Za-z0-9._-]+$/.test(n) && n !== '.' && n !== '..'
  const okGit = staleGit.filter(safe)
  const okWt = staleWt.filter(safe)
  if (okGit.length === 0 && okWt.length === 0) return null
  const targets = [
    ...okGit.map(n => shq(ppath.join(remoteRoot, '.git/worktrees', n))),
    ...okWt.map(n => shq(ppath.join(remoteWtsRoot, n))),
  ].join(' ')
  return `rm -rf ${targets}`
}

// Default impure boundary: invoke ssh with a script. Returns stdout on
// success; throws on any ssh failure (caller decides whether to soft-fail).
async function defaultSshExec(host, script) {
  const {stdout} = await execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', host, script],
  )
  return stdout
}

// Pre-flight reconciler: delete worktree dirs that exist on remote but not
// local. Catches drift from `rm -rf`, `git worktree prune`, or worktrees
// removed before the git-gate `worktree remove` hook landed.
//
// Soft-fails (warns, doesn't throw) on SSH errors — never block the user's
// command for an unreachable devbox.
//
// `sshExec` is injectable for testing; production callers omit it.
async function reconcileRemoteWorktrees({
  host,
  repoRoot = REPO_ROOT,
  remoteRoot = REMOTE_ROOT,
  remoteWtsRoot = REMOTE_WTS_ROOT,
  sshExec = defaultSshExec,
  log = msg => process.stderr.write(msg),
} = {}) {
  const localNames = localWorktreeNames(repoRoot)
  let listingStdout
  try {
    listingStdout = await sshExec(host, remoteWorktreeListingScript({remoteRoot, remoteWtsRoot}))
  } catch (e) {
    log(`[run-remote] worktree reconcile: skipped (ssh listing failed: ${(e.message || '').split('\n')[0]})\n`)
    return {status: 'skipped', reason: 'ssh-listing-failed'}
  }
  const remote = parseRemoteWorktreeListing(listingStdout)
  const staleGit = computeStaleWorktreeNames({localNames, remoteNames: remote.git})
  const staleWt = computeStaleWorktreeNames({localNames, remoteNames: remote.wt})
  const cleanupScript = buildReconcileCleanupScript({staleGit, staleWt, remoteRoot, remoteWtsRoot})
  if (cleanupScript === null) return {status: 'clean'}
  log(`[run-remote] worktree reconcile: removing stale on remote — git=[${staleGit.join(',')}] wt=[${staleWt.join(',')}]\n`)
  try {
    await sshExec(host, cleanupScript)
  } catch (e) {
    log(`[run-remote] worktree reconcile: skipped cleanup (ssh failed: ${(e.message || '').split('\n')[0]})\n`)
    return {status: 'skipped', reason: 'ssh-cleanup-failed', staleGit, staleWt}
  }
  return {status: 'cleaned', staleGit, staleWt}
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
  process.stderr.write(`[run-remote] routing to ${host} via '${syncContext.session}' (reconciling worktrees…)\n`)
  await reconcileRemoteWorktrees({host})
  repairLocalWorktreeMetadataIfNeeded()
  const mutagenListOutput = await readMutagenSession(syncContext.session)
  assertSessionAlive(syncContext.session, mutagenListOutput)
  assertOneWayReplica(syncContext.session, mutagenListOutput)
  process.stderr.write(`[run-remote] flushing mutagen '${syncContext.session}' before ssh ${host}…\n`)
  await flushMutagenSession(syncContext.session)
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
  assertSessionAlive,
  buildReconcileCleanupScript,
  computeStaleWorktreeNames,
  ensureRemoteWorktreeReadyScript,
  flushMutagenSession,
  parseRemoteWorktreeListing,
  parseSessionConnectivity,
  readMutagenSession,
  reconcileRemoteWorktrees,
  remoteWorktreeListingScript,
  repairRemoteWorktreeMetadataScript,
  repairLocalWorktreeMetadataIfNeeded,
  remoteHostFromEnvironment,
  resolveSyncContext,
  localMainCheckoutRoot,
  localWtsRoot,
  localWorktreeName,
  remoteWorktreeRoot,
  synchronizationMode,
}
