#!/usr/bin/env node
import {spawnSync, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import {fileURLToPath} from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SOURCE_REPO_ROOT = resolve(dirname(SCRIPT_PATH), '../../..')
const MARKER_RELATIVE_PATH = join('node_modules', '.voicetree-worktree-ready.json')

// Worktrees live as a sibling of the main checkout (e.g. /repos/voicetree-public
// + /repos/vt-wts/<name>/). The directory name must stay in sync with the
// duplicated constant in webapp gitWorktreeCommands.ts and agent-runtime
// terminalData.ts. See those files for the rationale.
const WORKTREE_SIBLING_DIR_NAME = 'vt-wts'
const MAIN_REPO_DIR_NAME = 'voicetree-public'

function pathExists(path) {
  return existsSync(path)
}

function isInsidePath(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function sortedExistingPaths(root, relativePaths) {
  return relativePaths
    .filter(path => pathExists(join(root, path)))
    .sort()
}

function childPackageJsonPaths(root, relativeDir) {
  const absoluteDir = join(root, relativeDir)
  if (!pathExists(absoluteDir)) return []
  return readdirSync(absoluteDir, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => join(relativeDir, entry.name, 'package.json'))
    .filter(path => pathExists(join(root, path)))
}

function dependencyInputPaths(root) {
  return sortedExistingPaths(root, [
    'package.json',
    'package-lock.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    '.npmrc',
    'webapp/package.json',
    ...childPackageJsonPaths(root, join('packages', 'libraries')),
    ...childPackageJsonPaths(root, join('packages', 'systems')),
    join('packages', 'measures', 'package.json'),
  ])
}

function isPnpmWorkspace(root) {
  return pathExists(join(root, 'pnpm-workspace.yaml'))
}

function dependencyFingerprint(root) {
  const hash = createHash('sha256')
  for (const relativePath of dependencyInputPaths(root)) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(join(root, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function markerPath(root) {
  return join(root, MARKER_RELATIVE_PATH)
}

function dependencyDirectories(root) {
  return [
    'node_modules',
    ...(pathExists(join(root, 'webapp', 'package.json')) ? [join('webapp', 'node_modules')] : []),
  ]
}

function dependencyDirectoriesPresent(root) {
  return dependencyDirectories(root).every(relativePath => pathExists(join(root, relativePath)))
}

function readReadyMarker(root) {
  const path = markerPath(root)
  if (!pathExists(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeReadyMarker(root, fingerprint) {
  const path = markerPath(root)
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(
    path,
    `${JSON.stringify({
      dependencyFingerprint: fingerprint,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  )
}

function hasCurrentReadyMarker(root, fingerprint) {
  const marker = readReadyMarker(root)
  return marker?.dependencyFingerprint === fingerprint && dependencyDirectoriesPresent(root)
}

function repoRootFromGit(inputPath) {
  try {
    return execFileSync('git', ['-C', inputPath, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function mainWorktreeFromGit(inputPath) {
  try {
    const stdout = execFileSync('git', ['-C', inputPath, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const firstWorktree = stdout.match(/^worktree (.+)$/m)?.[1]
    return firstWorktree ?? null
  } catch {
    return null
  }
}

function mainRepoFromPath(path) {
  const parts = resolve(path).split(sep)
  const index = parts.lastIndexOf(WORKTREE_SIBLING_DIR_NAME)
  if (index <= 0) return null
  // Sibling layout: <parent>/vt-wts/<name>/  →  main repo at <parent>/voicetree-public
  const parentParts = parts.slice(0, index)
  const parentPrefix = parentParts.join(sep)
  const parent = parentPrefix === '' ? sep : parentPrefix
  return join(parent, MAIN_REPO_DIR_NAME)
}

function resolveWorktreeRoot(inputPath) {
  return realpathSync(repoRootFromGit(inputPath) ?? resolve(inputPath))
}

function resolveMainRepoRoot(worktreeRoot) {
  const fromGit = mainWorktreeFromGit(worktreeRoot)
  if (fromGit !== null && pathExists(fromGit)) return realpathSync(fromGit)

  const fromPath = mainRepoFromPath(worktreeRoot)
  if (fromPath !== null && pathExists(fromPath)) return realpathSync(fromPath)

  return worktreeRoot
}

function removePathIfPresent(path) {
  if (!pathExists(path)) return
  rmSync(path, {recursive: true, force: true})
}

function copyPath(source, target) {
  mkdirSync(dirname(target), {recursive: true})
  const result = spawnSync('cp', ['-a', source, target], {stdio: 'inherit'})
  if (result.status !== 0) {
    throw new Error(`cp -a failed for ${source} -> ${target}`)
  }
}

function seedNodeModulesFromSource({sourceRoot, targetRoot}) {
  for (const relativeDir of dependencyDirectories(targetRoot)) {
    const source = join(sourceRoot, relativeDir)
    const target = join(targetRoot, relativeDir)
    if (!pathExists(source)) continue
    removePathIfPresent(target)
    copyPath(source, target)
  }
}

function removeDependencySymlinks(root) {
  for (const relativeDir of dependencyDirectories(root)) {
    const target = join(root, relativeDir)
    if (!pathExists(target)) continue
    if (lstatSync(target).isSymbolicLink()) removePathIfPresent(target)
  }
}

function runNpmInstall(targetRoot) {
  const commandArgs = ['install', '--prefer-offline', '--no-audit', '--fund=false']
  const result = spawnSync('npm', commandArgs, {cwd: targetRoot, stdio: 'inherit'})
  if (result.status !== 0) {
    throw new Error(`npm ${commandArgs.join(' ')} failed in ${targetRoot}`)
  }
}

function runPnpmInstall(targetRoot) {
  const lockfilePresent = pathExists(join(targetRoot, 'pnpm-lock.yaml'))
  const commandArgs = lockfilePresent
    ? ['install', '--prefer-offline', '--frozen-lockfile']
    : ['install', '--prefer-offline']
  const result = spawnSync('pnpm', commandArgs, {cwd: targetRoot, stdio: 'inherit'})
  if (result.status !== 0) {
    throw new Error(`pnpm ${commandArgs.join(' ')} failed in ${targetRoot}`)
  }
}

function defaultInstallDependencies(targetRoot) {
  if (isPnpmWorkspace(targetRoot)) runPnpmInstall(targetRoot)
  else runNpmInstall(targetRoot)
}

function ensureEnvSymlink({sourceRoot, targetRoot}) {
  if (sourceRoot === targetRoot) return 'same-root'
  const sourceEnv = join(sourceRoot, '.env')
  const targetEnv = join(targetRoot, '.env')
  if (!pathExists(sourceEnv)) return 'source-missing'
  if (pathExists(targetEnv)) return 'target-present'
  symlinkSync(relative(targetRoot, sourceEnv), targetEnv)
  return 'linked'
}

function verifyWorkspaceLinksStayInsideTarget(targetRoot) {
  const atVtPath = join(targetRoot, 'node_modules', '@vt')
  if (!pathExists(atVtPath)) return

  for (const entry of readdirSync(atVtPath)) {
    const linkPath = join(atVtPath, entry)
    const stat = lstatSync(linkPath)
    if (!stat.isSymbolicLink()) continue
    const resolved = realpathSync(linkPath)
    if (!isInsidePath(targetRoot, resolved)) {
      throw new Error(`${linkPath} resolves to ${resolved}, outside ${targetRoot}`)
    }
  }
}

function sourceCanSeedTarget({sourceRoot, targetRoot, targetFingerprint}) {
  return sourceSeedBlockReason({sourceRoot, targetRoot, targetFingerprint}) === null
}

function sourceSeedBlockReason({sourceRoot, targetRoot, targetFingerprint}) {
  if (sourceRoot === targetRoot) return 'target is the main checkout'
  if (!dependencyDirectoriesPresent(sourceRoot)) return `source dependency directories are missing in ${sourceRoot}`
  if (dependencyFingerprint(sourceRoot) !== targetFingerprint) return 'dependency inputs differ between source and worktree'
  return null
}

function sourceCanCopyDependencies({sourceRoot, targetRoot}) {
  return sourceDependencyCopyBlockReason({sourceRoot, targetRoot}) === null
}

function sourceDependencyCopyBlockReason({sourceRoot, targetRoot}) {
  if (sourceRoot === targetRoot) return 'target is the main checkout'
  if (!dependencyDirectoriesPresent(sourceRoot)) return `source dependency directories are missing in ${sourceRoot}`
  return null
}

function ensureWorktreeReady(inputPath, {installDependencies = defaultInstallDependencies, log = console.error} = {}) {
  const targetRoot = resolveWorktreeRoot(inputPath)
  const sourceRoot = resolveMainRepoRoot(targetRoot)
  const fingerprint = dependencyFingerprint(targetRoot)
  const pnpm = isPnpmWorkspace(targetRoot)

  log(`[worktree-ready] target: ${targetRoot}`)
  log(`[worktree-ready] source: ${sourceRoot}`)
  if (pnpm) log('[worktree-ready] pnpm-workspace.yaml detected; using pnpm install (skipping cp-seed)')

  const envStatus = ensureEnvSymlink({sourceRoot, targetRoot})
  if (envStatus === 'linked') log('[worktree-ready] linked .env from source checkout')
  if (envStatus === 'source-missing') log('[worktree-ready] source .env missing; skipping .env link')
  if (envStatus === 'target-present') log('[worktree-ready] worktree .env already present; leaving it unchanged')

  if (hasCurrentReadyMarker(targetRoot, fingerprint)) {
    log(`[worktree-ready] already ready: ${targetRoot}`)
    verifyWorkspaceLinksStayInsideTarget(targetRoot)
    return {status: 'ready', sourceRoot, targetRoot}
  }

  // pnpm path: don't cp-seed. The content-addressable store provides better
  // cross-worktree sharing (hardlinks/clonefile) than copy-on-create. A fresh
  // `pnpm install` with the store warm typically completes in <15s.
  if (pnpm) {
    log(`[worktree-ready] running pnpm install to populate dependencies in ${targetRoot}`)
    installDependencies(targetRoot)
    verifyWorkspaceLinksStayInsideTarget(targetRoot)
    writeReadyMarker(targetRoot, dependencyFingerprint(targetRoot))
    return {status: 'installed', sourceRoot, targetRoot}
  }

  const seedBlockReason = sourceSeedBlockReason({sourceRoot, targetRoot, targetFingerprint: fingerprint})
  if (seedBlockReason === null) {
    log(`[worktree-ready] copying node_modules from ${sourceRoot} to ${targetRoot}`)
    seedNodeModulesFromSource({sourceRoot, targetRoot})
    verifyWorkspaceLinksStayInsideTarget(targetRoot)
    writeReadyMarker(targetRoot, fingerprint)
    return {status: 'seeded', sourceRoot, targetRoot}
  }

  const copyBlockReason = sourceDependencyCopyBlockReason({sourceRoot, targetRoot})
  if (copyBlockReason === null) {
    log(`[worktree-ready] copying node_modules from ${sourceRoot} to ${targetRoot}`)
    log(`[worktree-ready] reconciling copied dependencies: ${seedBlockReason}`)
    seedNodeModulesFromSource({sourceRoot, targetRoot})
  } else {
    log(`[worktree-ready] not copying node_modules: ${copyBlockReason}`)
  }

  log(`[worktree-ready] running npm install to reconcile dependencies in ${targetRoot}`)
  removeDependencySymlinks(targetRoot)
  installDependencies(targetRoot)
  verifyWorkspaceLinksStayInsideTarget(targetRoot)
  writeReadyMarker(targetRoot, dependencyFingerprint(targetRoot))
  return {status: copyBlockReason === null ? 'reconciled' : 'installed', sourceRoot, targetRoot}
}

function main(argv = process.argv.slice(2)) {
  const targetPath = argv[0] ?? process.cwd()
  ensureWorktreeReady(targetPath)
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH

if (isDirectRun) {
  try {
    main()
  } catch (error) {
    console.error(`[worktree-ready] ${error.message}`)
    process.exit(1)
  }
}

export {
  dependencyFingerprint,
  dependencyInputPaths,
  ensureWorktreeReady,
  mainRepoFromPath,
  markerPath,
  resolveMainRepoRoot,
  resolveWorktreeRoot,
  sourceDependencyCopyBlockReason,
  sourceSeedBlockReason,
}
