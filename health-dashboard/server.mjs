#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const REPO_ROOT = resolve(__dirname, '..')
const PORT = Number(process.env.PORT ?? 8765)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.map':  'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
}

const gitArgs = ['-C', REPO_ROOT]

async function git(args) {
  const { stdout } = await execFileAsync('git', [...gitArgs, ...args], { maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

async function gitOr(args, fallback) {
  try { return await git(args) } catch { return fallback }
}

const MANIFEST_TTL_MS = 30_000
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const CHECK_RUNNER = join(REPO_ROOT, 'packages', 'measures', 'src', '_runners', 'capture-ci-checks.ts')
let manifestCache = { fetchedAt: 0, payload: null }

async function loadCheckManifest() {
  const { stdout } = await execFileAsync(TSX_BIN, [CHECK_RUNNER, '--list-json'], {
    cwd: REPO_ROOT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function buildCheckManifest({ fresh } = {}) {
  const now = Date.now()
  if (!fresh && manifestCache.payload && now - manifestCache.fetchedAt < MANIFEST_TTL_MS) {
    return manifestCache.payload
  }
  const checks = await loadCheckManifest()
  manifestCache = { fetchedAt: now, payload: { checks, generatedAt: new Date(now).toISOString() } }
  return manifestCache.payload
}

function topDir(p) {
  const i = p.indexOf('/')
  return i === -1 ? p : p.slice(0, i)
}

// `git diff --numstat -z` outputs: <adds>\t<dels>\t<path>\0  (binary files: -\t-\t)
function parseNumstatZ(stdout) {
  const out = []
  const parts = stdout.split('\0').filter(Boolean)
  for (const part of parts) {
    const tabA = part.indexOf('\t')
    const tabB = part.indexOf('\t', tabA + 1)
    if (tabA === -1 || tabB === -1) continue
    const adds = part.slice(0, tabA)
    const dels = part.slice(tabA + 1, tabB)
    const path = part.slice(tabB + 1)
    out.push({
      path,
      adds: adds === '-' ? 0 : Number(adds) || 0,
      dels: dels === '-' ? 0 : Number(dels) || 0,
    })
  }
  return out
}

// `git status --porcelain=v1 -z`: <XY> <path>\0  (rename: <XY> <new>\0<old>\0)
function parseStatusZ(stdout) {
  const items = []
  let i = 0
  while (i < stdout.length) {
    const end = stdout.indexOf('\0', i)
    if (end === -1) break
    const entry = stdout.slice(i, end)
    const xy = entry.slice(0, 2)
    const path = entry.slice(3)
    items.push({ xy, path })
    i = end + 1
    if (xy[0] === 'R' || xy[0] === 'C') {
      const oldEnd = stdout.indexOf('\0', i)
      if (oldEnd === -1) break
      i = oldEnd + 1
    }
  }
  return items
}

async function untrackedLineCount(path) {
  try {
    const buf = await readFile(join(REPO_ROOT, path))
    if (buf.length === 0) return 0
    let count = 1
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) count++
    if (buf[buf.length - 1] === 0x0a) count--
    return count
  } catch { return 0 }
}

async function buildGitStatus() {
  const [branch, upstream, log, numstatTracked, statusOut] = await Promise.all([
    gitOr(['rev-parse', '--abbrev-ref', 'HEAD'], '').then(s => s.trim()),
    gitOr(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], '').then(s => s.trim()),
    gitOr(['log', '-5', '--pretty=tformat:%h%x1f%s%x1f%b%x1f%an%x1f%cI%x1e'], ''),
    gitOr(['diff', 'HEAD', '--numstat', '-z'], ''),
    gitOr(['status', '--porcelain=v1', '-z'], ''),
  ])

  let ahead = 0, behind = 0, hasUpstream = false
  if (upstream) {
    const m = upstream.split(/\s+/)
    if (m.length === 2) {
      ahead = Number(m[0]) || 0
      behind = Number(m[1]) || 0
      hasUpstream = true
    }
  }

  const commits = log.split('\x1e').map(s => s.replace(/^\n+/, '')).filter(Boolean).map(record => {
    const [hash, subject, body, author, iso] = record.split('\x1f')
    return { hash, subject, body: (body ?? '').trimEnd(), author, iso }
  })

  const tracked = parseNumstatZ(numstatTracked)
  const statusEntries = parseStatusZ(statusOut)
  const trackedPaths = new Set(tracked.map(t => t.path))

  const untracked = statusEntries.filter(e => e.xy === '??' && !trackedPaths.has(e.path))
  const untrackedCounts = await Promise.all(untracked.map(u => untrackedLineCount(u.path)))

  const folders = new Map()
  function bump(path, patch) {
    const dir = topDir(path) || '.'
    let cur = folders.get(dir)
    if (!cur) { cur = { folder: dir, files: 0, adds: 0, dels: 0, untracked: 0 }; folders.set(dir, cur) }
    if (patch.files) cur.files += patch.files
    if (patch.adds)  cur.adds  += patch.adds
    if (patch.dels)  cur.dels  += patch.dels
    if (patch.untracked) cur.untracked += patch.untracked
  }

  for (const t of tracked) {
    bump(t.path, { files: 1, adds: t.adds, dels: t.dels })
  }
  untracked.forEach((u, idx) => {
    bump(u.path, { files: 1, adds: untrackedCounts[idx], untracked: 1 })
  })

  const dirtyFolders = [...folders.values()].sort((a, b) =>
    (b.adds + b.dels) - (a.adds + a.dels) || b.files - a.files || a.folder.localeCompare(b.folder)
  )

  const totals = {
    files: tracked.length + untracked.length,
    adds: tracked.reduce((s, t) => s + t.adds, 0) + untrackedCounts.reduce((s, n) => s + n, 0),
    dels: tracked.reduce((s, t) => s + t.dels, 0),
    untracked: untracked.length,
  }

  return {
    branch: branch || '(detached)',
    upstream: { hasUpstream, ahead, behind },
    commits,
    dirtyFolders,
    totals,
    generatedAt: new Date().toISOString(),
  }
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  })
  res.end(buf)
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const target = resolve(ROOT, normalize(rel))
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const st = await stat(target)
    if (st.isDirectory()) {
      const indexPath = join(target, 'index.html')
      const buf = await readFile(indexPath)
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
      res.end(buf)
      return
    }
    const buf = await readFile(target)
    const ext = extname(target).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found')
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/git' || req.url?.startsWith('/api/git?')) {
      const data = await buildGitStatus()
      sendJson(res, 200, data)
      return
    }
    if (req.url === '/api/checks/manifest' || req.url?.startsWith('/api/checks/manifest?')) {
      const fresh = new URL(req.url, 'http://x').searchParams.has('fresh')
      const data = await buildCheckManifest({ fresh })
      sendJson(res, 200, data)
      return
    }
    await serveStatic(req, res)
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, () => {
  console.log(`health-dashboard serving at http://localhost:${PORT}`)
})
