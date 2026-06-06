/**
 * Stage a standalone Node runtime into the Electron resources so it ships inside
 * the packaged app.
 *
 * The packaged app spawns two Node daemons (vtd + its vt-graphd sibling) as
 * separate child processes. They need `node:sqlite` (Node ≥22) and must NOT run
 * on the Electron binary (its node ABI can't host node:sqlite — see
 * @vt/graph-db-client resolveDaemonRuntimeCommand, which deliberately excludes
 * the Electron binary). A normal user's machine may have no `node` on PATH, so
 * the app carries its own. main.ts points VT_GRAPHD_NODE_BIN at it
 * (Resources/node/node); the resolver — shared by graphd AND vtd — selects it.
 *
 * This downloads the official nodejs.org build for the target platform/arch,
 * verifies it against the published SHASUMS256.txt, extracts just `bin/node`,
 * and (when the target is the host arch) runs a node:sqlite probe so a bad pin
 * fails the build LOUDLY rather than shipping a daemon that can't open its DB.
 *
 * Usage:
 *   node scripts/stage-node-runtime.mjs                 # host platform/arch → out/resources/node
 *   node scripts/stage-node-runtime.mjs --dest <dir>    # custom destination dir
 *   node scripts/stage-node-runtime.mjs --platform linux --arch arm64 --dest <dir>
 *
 * Must run BEFORE `electron-builder` (which copies out/resources/node via
 * extraResources). Mirrors stage-daemon-bundles.mjs.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Pinned standalone Node runtime for the bundled daemons. Bump deliberately;
// the SHA is fetched from the official SHASUMS256.txt for this exact version, so
// only this constant changes. Must be a version whose `node:sqlite` DatabaseSync
// is usable without an --experimental flag (the probe below enforces it).
const NODE_VERSION = '22.22.2'
const DIST_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`

const __dirname = dirname(fileURLToPath(import.meta.url))
const webappDir = resolve(__dirname, '..')
const repoRoot = resolve(webappDir, '..')

function parseArgs(argv) {
  const args = { platform: process.platform, arch: process.arch, dest: resolve(repoRoot, 'out/resources/node') }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--platform') args.platform = argv[++i]
    else if (flag === '--arch') args.arch = argv[++i]
    else if (flag === '--dest') args.dest = resolve(argv[++i])
    else throw new Error(`[stage-node-runtime] unknown argument: ${flag}`)
  }
  return args
}

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[stage-node-runtime] GET ${url} → ${res.status} ${res.statusText}`)
  return Buffer.from(await res.arrayBuffer())
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function verifyChecksum(buf, want, label) {
  const got = sha256(buf)
  if (got !== want) {
    throw new Error(`[stage-node-runtime] checksum mismatch for ${label}\n  expected ${want}\n  got      ${got}`)
  }
  console.log(`[stage-node-runtime] sha256 verified (${label}): ${got}`)
}

// SHASUMS256.txt is a list of `<sha256>  <filename>` lines for the release.
function expectedSha(shasums, filename) {
  for (const line of shasums.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/)
    if (name === filename) return sha
  }
  throw new Error(`[stage-node-runtime] ${filename} not found in SHASUMS256.txt`)
}

async function main() {
  const { platform, arch, dest } = parseArgs(process.argv.slice(2))

  // nodejs.org uses the same platform/arch tokens Node reports (darwin/linux/win32
  // → win, arm64/x64). darwin/linux ship a .tar.gz holding bin/node; win ships the
  // bare node.exe at win-<arch>/node.exe (no archive to extract).
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'
  mkdirSync(dest, { recursive: true })
  const stagedBinary = join(dest, binaryName)

  // Idempotency: a 113 MB download on every local `electron:dist` is wasteful.
  // Skip ONLY when a host-arch binary already reports the exact pinned version
  // (so we know it ran and is correct). Cross-arch binaries can't be probed, so
  // they always re-stage; CI runs on fresh runners and re-downloads regardless.
  if (existsSync(stagedBinary) && platform === process.platform && arch === process.arch) {
    try {
      const version = execFileSync(stagedBinary, ['--version'], { encoding: 'utf8' }).trim()
      if (version === `v${NODE_VERSION}`) {
        console.log(`[stage-node-runtime] ${binaryName} already staged at the pinned version (${version}); skipping download`)
        return
      }
    } catch {
      // Unrunnable/corrupt — fall through and re-stage.
    }
  }

  const shasums = (await download(`${DIST_BASE}/SHASUMS256.txt`)).toString('utf8')

  if (platform === 'win32') {
    const remote = `win-${arch}/node.exe`
    console.log(`[stage-node-runtime] fetching ${remote} (node:sqlite host for the packaged daemons)…`)
    const binary = await download(`${DIST_BASE}/${remote}`)
    verifyChecksum(binary, expectedSha(shasums, remote), remote)
    writeFileSync(stagedBinary, binary)
  } else {
    const tag = `node-v${NODE_VERSION}-${platform}-${arch}`
    const tarball = `${tag}.tar.gz`
    console.log(`[stage-node-runtime] fetching ${tarball} (node:sqlite host for the packaged daemons)…`)
    const archive = await download(`${DIST_BASE}/${tarball}`)
    verifyChecksum(archive, expectedSha(shasums, tarball), tarball)
    const work = mkdtempSync(join(tmpdir(), 'vt-node-runtime-'))
    try {
      const archivePath = join(work, tarball)
      writeFileSync(archivePath, archive)
      // Extract ONLY bin/node, flattening it directly into dest/.
      execFileSync('tar', ['-xzf', archivePath, '-C', dest, '--strip-components=2', `${tag}/bin/${binaryName}`], {
        stdio: 'inherit',
      })
    } finally {
      rmSync(work, { force: true, recursive: true })
    }
  }

  if (!existsSync(stagedBinary)) {
    throw new Error(`[stage-node-runtime] expected ${stagedBinary} after staging, but it is missing`)
  }
  chmodSync(stagedBinary, 0o755)
  console.log(`[stage-node-runtime] staged ${binaryName} → ${stagedBinary}`)

  // Probe node:sqlite, but only when the staged binary matches the host (a
  // cross-arch binary can't execute here). CI jobs are native per arch, so the
  // probe runs in CI; local cross-staging skips it with a notice.
  if (platform === process.platform && arch === process.arch) {
    const probe = "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"
    try {
      execFileSync(stagedBinary, ['-e', probe], { stdio: 'pipe' })
      console.log(`[stage-node-runtime] node:sqlite probe passed on Node ${NODE_VERSION} (${platform}-${arch})`)
    } catch (err) {
      throw new Error(
        `[stage-node-runtime] node:sqlite probe FAILED on the staged Node ${NODE_VERSION} (${platform}-${arch}). ` +
          `This version cannot host vt-graphd. ${err.stderr ? err.stderr.toString() : err.message}`,
      )
    }
  } else {
    console.log(`[stage-node-runtime] skipping node:sqlite probe (staged ${platform}-${arch} ≠ host ${process.platform}-${process.arch})`)
  }
}

await main()
