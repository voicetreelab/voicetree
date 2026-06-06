#!/usr/bin/env node
import { existsSync, rmSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const options = {
    platform: process.platform === 'darwin' ? 'mac' : 'linux-remote',
    skipBuild: false,
    skipServer: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--platform') {
      options.platform = argv[++i]
    } else if (arg === '--skip-build') {
      options.skipBuild = true
    } else if (arg === '--skip-server') {
      options.skipServer = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (!['mac', 'linux-remote'].includes(options.platform)) {
    throw new Error(`unsupported --platform ${options.platform}`)
  }
  return options
}

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function ensureUvOnPath() {
  const localBin = join(homedir(), '.local', 'bin')
  process.env.PATH = `${localBin}:${process.env.PATH ?? ''}`
  const probe = spawnSync('uv', ['--version'], { stdio: 'ignore' })
  if (probe.status === 0) return

  console.log('[release-smoke] uv not found; installing via astral.sh')
  run('bash', ['-lc', 'curl -LsSf https://astral.sh/uv/install.sh | sh'])
  process.env.PATH = `${localBin}:${process.env.PATH ?? ''}`
  const installed = spawnSync('uv', ['--version'], { stdio: 'inherit', env: process.env })
  if (installed.status !== 0) throw new Error('uv install completed but uv is still unavailable')
}

function copyReleaseResources(fromName) {
  const from = join(repoRoot, 'out', fromName)
  const to = join(repoRoot, 'out', 'resources')
  if (!existsSync(from)) throw new Error(`missing ${from}; server build did not produce resources`)
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  stageCommonResources(to)
}

function stageCommonResources(to) {
  copyIfExists(join(repoRoot, 'tools'), join(to, 'tools'))
  copyIfExists(join(repoRoot, 'backend', 'context_retrieval'), join(to, 'backend', 'context_retrieval'))
  copyIfExists(join(repoRoot, 'backend', 'markdown_tree_manager'), join(to, 'backend', 'markdown_tree_manager'))
  for (const file of ['__init__.py', 'types.py', 'logging_config.py']) {
    copyIfExists(join(repoRoot, 'backend', file), join(to, 'backend', file))
  }
}

function copyIfExists(from, to) {
  if (!existsSync(from)) return
  cpSync(from, to, { recursive: true })
}

function buildServer(platform) {
  if (platform === 'mac') {
    run('./scripts/build_server.sh', [])
    stageCommonResources(join(repoRoot, 'out', 'resources'))
    return
  }
  ensureUvOnPath()
  run('./scripts/build_server_linux_x64.sh', [])
  copyReleaseResources('resources-linux-x64')
}

function buildElectron(platform) {
  run('pnpm', ['--filter', 'voicetree-webapp', 'exec', 'electron-vite', 'build'])
  run('pnpm', ['--dir', 'webapp', 'run', 'stage:daemons'])
  run('pnpm', ['--dir', 'webapp', 'run', 'stage:node'])

  const electronVersion = resolveElectronVersion()
  const builderArgs = platform === 'mac'
    ? ['--mac', '--config', '-c.mac.identity=null', '--publish=never', `-c.electronVersion=${electronVersion}`]
    : ['--linux', '--x64', '--publish=never', `-c.electronVersion=${electronVersion}`]
  run('pnpm', ['--dir', 'webapp', 'exec', 'electron-builder', ...builderArgs], {
    env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  })
}

function resolveElectronVersion() {
  const result = spawnSync(process.execPath, ['-p', 'require("electron/package.json").version'], {
    cwd: join(repoRoot, 'webapp'),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error('could not resolve installed Electron version')
  return result.stdout.trim()
}

function findPackagedExecutable(platform) {
  if (platform === 'mac') {
    const candidates = [
      join(repoRoot, 'out/electron/mac-arm64/Voicetree.app/Contents/MacOS/Voicetree'),
      join(repoRoot, 'out/electron/mac/Voicetree.app/Contents/MacOS/Voicetree'),
      join(repoRoot, 'out/electron/mac-universal/Voicetree.app/Contents/MacOS/Voicetree'),
    ]
    const found = candidates.find(existsSync)
    if (found) return found
  }

  const linuxCandidates = [
    join(repoRoot, 'out/electron/linux-unpacked/voicetree-webapp'),
    join(repoRoot, 'out/electron/linux-unpacked/voicetree'),
    join(repoRoot, 'out/electron/linux-x64-unpacked/voicetree-webapp'),
    join(repoRoot, 'out/electron/linux-x64-unpacked/voicetree'),
  ]
  const found = linuxCandidates.find(existsSync)
  if (found) return found

  throw new Error(`could not find packaged ${platform} executable under out/electron`)
}

function runPackagedSmoke(executable) {
  run(process.execPath, [
    '--no-warnings=ExperimentalWarning',
    '--experimental-strip-types',
    '../packages/measures/src/_runners/run-with-xvfb-if-needed.ts',
    'pnpm',
    'exec',
    'playwright',
    'test',
    '--config=playwright-tier1-system.config.ts',
    'e2e-tests/highest-value-system/electron-smoke-test.spec.ts',
  ], {
    cwd: join(repoRoot, 'webapp'),
    env: {
      VOICETREE_RELEASE_SMOKE_EXECUTABLE: executable,
      HEADLESS_TEST: '1',
    },
  })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  console.log(`[release-smoke] platform=${options.platform} skipBuild=${options.skipBuild} skipServer=${options.skipServer}`)
  if (!options.skipBuild) {
    if (!options.skipServer) buildServer(options.platform)
    buildElectron(options.platform)
  }
  const executable = findPackagedExecutable(options.platform)
  console.log(`[release-smoke] executable=${executable}`)
  runPackagedSmoke(executable)
}

main()
