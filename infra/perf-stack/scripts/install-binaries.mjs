#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const STACK_DIR = resolve(SCRIPT_DIR, '..')
const BIN_DIR = join(STACK_DIR, 'bin')
const MANIFEST_PATH = join(BIN_DIR, '.install-manifest.json')

const PLATFORM = `${process.platform}-${process.arch}`

const BINARIES = [
  {
    name: 'grafana',
    version: 'v13.0.1',
    kind: 'archive',
    urlPattern: () =>
      'https://dl.grafana.com/grafana/release/13.0.1/grafana_13.0.1_24542347077_darwin_arm64.tar.gz',
    sha256: {
      'darwin-arm64': '5bf866290341d8f7fd14da5f11fc2a22f9d6d09da10519823ccab6835a448b3b',
    },
    binaryCandidates: ['grafana'],
    homeDir: 'grafana-home',
  },
  {
    name: 'loki',
    version: 'v3.7.2',
    kind: 'archive',
    urlPattern: () => 'https://github.com/grafana/loki/releases/download/v3.7.2/loki-darwin-arm64.zip',
    sha256: {
      'darwin-arm64': 'daf689642ba0a96c627d1de092a48fc4b5ac4d583a08a04dbb85fd50133c28dd',
    },
    binaryCandidates: ['loki-darwin-arm64', 'loki'],
  },
  {
    name: 'logcli',
    version: 'v3.7.2',
    kind: 'archive',
    urlPattern: () => 'https://github.com/grafana/loki/releases/download/v3.7.2/logcli-darwin-arm64.zip',
    sha256: {
      'darwin-arm64': '21f1ce5b20f6399ee636a7102823cf4b40c7f0231d7de614b8f50ef811a73075',
    },
    binaryCandidates: ['logcli-darwin-arm64', 'logcli'],
  },
  {
    name: 'tempo',
    version: 'v2.10.5',
    kind: 'source-build',
    urlPattern: () =>
      'https://github.com/grafana/tempo/archive/991ce39eb956e9ed771fcffe05eff42d33de27ba.tar.gz',
    sha256: {
      'darwin-arm64': 'd8d1c1c7949343263621fa5d6b98030486841d1fb64622bbbbcb7ac21b593540',
    },
    buildDirName: 'tempo-991ce39eb956e9ed771fcffe05eff42d33de27ba',
    buildTarget: './cmd/tempo',
    note: 'No darwin-arm64 release archive exists for Tempo v2.10.5; built from the pinned tag commit source archive.',
  },
  {
    name: 'tempo-cli',
    version: 'v2.10.5',
    kind: 'source-build',
    urlPattern: () =>
      'https://github.com/grafana/tempo/archive/991ce39eb956e9ed771fcffe05eff42d33de27ba.tar.gz',
    sha256: {
      'darwin-arm64': 'd8d1c1c7949343263621fa5d6b98030486841d1fb64622bbbbcb7ac21b593540',
    },
    buildDirName: 'tempo-991ce39eb956e9ed771fcffe05eff42d33de27ba',
    buildTarget: './cmd/tempo-cli',
    note: 'Tempo CLI is source-only for this platform; built from the same checksum-pinned Tempo v2.10.5 source archive.',
  },
  {
    name: 'pprof',
    version: 'v0.0.0-20260507013755-92041b743c96',
    kind: 'source-build',
    urlPattern: () =>
      'https://github.com/google/pprof/archive/92041b743c966065641d7221da5403ad9a019bce.tar.gz',
    sha256: {
      'darwin-arm64': '0bf075c8839ab0f660c0a7119a4bf6ca394a4830018a3c21f5fe31650736087a',
    },
    buildDirName: 'pprof-92041b743c966065641d7221da5403ad9a019bce',
    buildTarget: '.',
    note: 'google/pprof publishes source, not release binaries; built from a checksum-pinned commit archive.',
  },
  {
    name: 'victoriametrics',
    version: 'v1.144.0',
    kind: 'archive',
    urlPattern: () =>
      'https://github.com/VictoriaMetrics/VictoriaMetrics/releases/download/v1.144.0/victoria-metrics-darwin-arm64-v1.144.0.tar.gz',
    sha256: {
      'darwin-arm64': '56e9b6ff18e599b59e948399e9e759e593abebdde670a39c0e6731227c322fc9',
    },
    binaryCandidates: ['victoria-metrics-prod', 'victoria-metrics'],
  },
  {
    name: 'promtool',
    version: 'v3.11.3',
    kind: 'archive',
    urlPattern: () =>
      'https://github.com/prometheus/prometheus/releases/download/v3.11.3/prometheus-3.11.3.darwin-arm64.tar.gz',
    sha256: {
      'darwin-arm64': '742773c5b3958eec5e6b58802f25cf77b47a319219ce0d508ed2f657c61d8859',
    },
    binaryCandidates: ['promtool'],
  },
  {
    name: 'pyroscope',
    version: 'v2.0.2',
    kind: 'archive',
    urlPattern: () =>
      'https://github.com/grafana/pyroscope/releases/download/v2.0.2/pyroscope_2.0.2_darwin_arm64.tar.gz',
    sha256: {
      'darwin-arm64': 'a8ebd0c3b9a5abe2d21c2bc2ad2076b5ea2b8adec09b69c09b450330816f8def',
    },
    binaryCandidates: ['pyroscope'],
  },
  {
    name: 'otelcol-contrib',
    version: 'v0.152.0',
    kind: 'archive',
    urlPattern: () =>
      'https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.152.0/otelcol-contrib_0.152.0_darwin_arm64.tar.gz',
    sha256: {
      'darwin-arm64': '0a5a4f595e7f1e6d885102fa89abdd41eb4fd1ef432ee7553818fef2ccb93339',
    },
    binaryCandidates: ['otelcol-contrib'],
  },
]

const exists = async (path) => access(path).then(() => true, () => false)

const readManifest = async () => {
  if (!(await exists(MANIFEST_PATH))) return {}
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
}

const writeManifest = async (manifest) => {
  await mkdir(BIN_DIR, { recursive: true })
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
}

const sha256File = async (path) => {
  const hash = createHash('sha256')
  const file = await import('node:fs').then((fs) => fs.createReadStream(path))
  for await (const chunk of file) hash.update(chunk)
  return hash.digest('hex')
}

const download = async (url, targetPath) => {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`download failed ${response.status} ${response.statusText}: ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath))
}

const extractArchive = async (archivePath, extractDir) => {
  await mkdir(extractDir, { recursive: true })
  const result = spawnSync('tar', ['-xf', archivePath, '-C', extractDir], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`tar failed for ${archivePath}\n${result.stderr || result.stdout}`)
  }
}

const findFirstExecutable = async (root, candidates) => {
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(root, { withFileTypes: true }))
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const found = await findFirstExecutable(path, candidates)
      if (found) return found
    } else if (candidates.includes(entry.name)) {
      return path
    }
  }
  return undefined
}

const installArchive = async (binary, manifest) => {
  const pinnedSha = binary.sha256[PLATFORM]
  if (!pinnedSha) {
    throw new Error(`${binary.name} has no pinned sha256 for ${PLATFORM}; refusing to install`)
  }

  const targetPath = join(BIN_DIR, binary.name)
  const record = manifest[binary.name]
  if (record?.platform === PLATFORM && record?.archiveSha256 === pinnedSha && await exists(targetPath)) {
    return { binary, status: 'skipped', targetPath, sha256: pinnedSha }
  }

  const tempDir = await mkdtemp(join(tmpdir(), `vt-perf-${binary.name}-`))
  try {
    const url = binary.urlPattern(process.platform, process.arch)
    const archivePath = join(tempDir, url.split('/').at(-1))
    await download(url, archivePath)

    const actualSha = await sha256File(archivePath)
    if (actualSha !== pinnedSha) {
      throw new Error(`${binary.name} sha256 mismatch: expected ${pinnedSha}, got ${actualSha}`)
    }

    const extractDir = join(tempDir, 'extract')
    await extractArchive(archivePath, extractDir)

    if (binary.homeDir) {
      const topEntries = await import('node:fs/promises').then((fs) => fs.readdir(extractDir))
      if (topEntries.length !== 1) throw new Error(`${binary.name} archive did not contain exactly one top directory`)
      await rm(join(BIN_DIR, binary.homeDir), { recursive: true, force: true })
      await copyTree(join(extractDir, topEntries[0]), join(BIN_DIR, binary.homeDir))
    }

    const extractedBinary = await findFirstExecutable(extractDir, binary.binaryCandidates)
    if (!extractedBinary) throw new Error(`${binary.name} archive did not contain ${binary.binaryCandidates.join(' or ')}`)

    await copyFile(extractedBinary, targetPath)
    await chmod(targetPath, 0o755)
    manifest[binary.name] = {
      version: binary.version,
      platform: PLATFORM,
      archiveSha256: pinnedSha,
      installedAt: new Date().toISOString(),
      source: url,
    }
    return { binary, status: 'installed', targetPath, sha256: pinnedSha }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const copyTree = async (from, to) => {
  await mkdir(dirname(to), { recursive: true })
  await import('node:fs/promises').then((fs) => fs.cp(from, to, { recursive: true }))
}

const installSourceBuild = async (binary, manifest) => {
  if (PLATFORM !== 'darwin-arm64') {
    throw new Error(`${binary.name} has no binary archive manifest for ${PLATFORM}; ${binary.note}`)
  }

  const pinnedSha = binary.sha256[PLATFORM]
  const targetPath = join(BIN_DIR, binary.name)
  const record = manifest[binary.name]
  if (record?.platform === PLATFORM && record?.sourceSha256 === pinnedSha && await exists(targetPath)) {
    return { binary, status: 'skipped', targetPath, sha256: pinnedSha }
  }

  const goVersion = spawnSync('go', ['version'], { encoding: 'utf8' })
  if (goVersion.status !== 0) throw new Error(`${binary.name} requires go for the darwin-arm64 source build`)

  const tempDir = await mkdtemp(join(tmpdir(), `vt-perf-${binary.name}-`))
  try {
    const url = binary.urlPattern(process.platform, process.arch)
    const archivePath = join(tempDir, 'source.tar.gz')
    await download(url, archivePath)
    const actualSha = await sha256File(archivePath)
    if (actualSha !== pinnedSha) {
      throw new Error(`${binary.name} source sha256 mismatch: expected ${pinnedSha}, got ${actualSha}`)
    }

    await extractArchive(archivePath, tempDir)
    const result = spawnSync('go', ['build', '-o', targetPath, binary.buildTarget], {
      cwd: join(tempDir, binary.buildDirName),
      env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN ?? 'auto' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.status !== 0) {
      throw new Error(`go build failed for ${binary.name}\n${result.stderr || result.stdout}`)
    }
    await chmod(targetPath, 0o755)
    manifest[binary.name] = {
      version: binary.version,
      platform: PLATFORM,
      sourceSha256: pinnedSha,
      verification: 'source archive sha256 plus Go module checksums',
      installedAt: new Date().toISOString(),
      source: url,
    }
    return { binary, status: 'installed', targetPath, sha256: pinnedSha }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const installBinary = async (binary, manifest) => {
  await mkdir(BIN_DIR, { recursive: true })
  if (binary.kind === 'archive') return installArchive(binary, manifest)
  if (binary.kind === 'source-build') return installSourceBuild(binary, manifest)
  throw new Error(`unknown binary kind ${binary.kind}`)
}

const main = async () => {
  const manifest = await readManifest()
  const results = []
  for (const binary of BINARIES) {
    const result = await installBinary(binary, manifest)
    await stat(result.targetPath)
    await writeManifest(manifest)
    results.push(result)
  }

  console.log('perf-stack binaries')
  console.log('name              version     platform       status      sha256')
  for (const result of results) {
    console.log([
      result.binary.name.padEnd(17),
      result.binary.version.padEnd(11),
      PLATFORM.padEnd(14),
      result.status.padEnd(11),
      result.sha256,
    ].join(' '))
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
