#!/usr/bin/env node
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = __dirname
const REPORTS_ROOT = resolve(homedir(), '.voicetree', 'reports')
const DEFAULT_PORT = 8766
const HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.cpuprofile': 'application/json; charset=utf-8',
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

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  })
  res.end(body)
}

function isWithin(rootDir, target) {
  const rel = relative(rootDir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function runDirForTs(ts) {
  const target = resolve(REPORTS_ROOT, `stable-perf-${ts}`)
  if (!isWithin(REPORTS_ROOT, target)) return null
  return target
}

async function dirSizeBytes(dir) {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await dirSizeBytes(path)
    } else if (entry.isFile()) {
      total += (await stat(path)).size
    }
  }
  return total
}

export async function listRuns() {
  let entries
  try {
    entries = await readdir(REPORTS_ROOT, { withFileTypes: true })
  } catch (err) {
    if (err?.code === 'ENOENT') return []
    throw err
  }

  const stableRuns = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('stable-perf-'))
    .map(entry => {
      const ts = entry.name.slice('stable-perf-'.length)
      const path = join(REPORTS_ROOT, entry.name)
      return { ts, path }
    })

  const withSizes = await Promise.all(stableRuns.map(async run => ({
    ...run,
    sizeBytes: await dirSizeBytes(run.path),
  })))

  return withSizes.sort((a, b) => b.ts.localeCompare(a.ts))
}

async function readDirNames(dir) {
  try {
    return await readdir(dir)
  } catch (err) {
    if (err?.code === 'ENOENT') return []
    throw err
  }
}

function metricServiceName(fileName) {
  return fileName.endsWith('.metrics.ndjson') ? fileName.slice(0, -'.metrics.ndjson'.length) : null
}

function traceServiceName(fileName) {
  return fileName.endsWith('.ndjson') ? fileName.slice(0, -'.ndjson'.length) : null
}

function cpuProfileServiceName(fileName) {
  return fileName.endsWith('.cpuprofile') ? fileName.slice(0, -'.cpuprofile'.length) : null
}

function addIfPresent(map, svc, value) {
  if (svc) map[svc] = value
}

export async function buildManifest(ts) {
  const runDir = runDirForTs(ts)
  if (!runDir) return null

  let runStat
  try {
    runStat = await stat(runDir)
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
  if (!runStat.isDirectory()) return null

  const [metricFiles, profileFiles, traceFiles] = await Promise.all([
    readDirNames(join(runDir, 'metrics')),
    readDirNames(join(runDir, 'profiles')),
    readDirNames(join(runDir, 'traces')),
  ])

  const metrics = {}
  for (const fileName of metricFiles) {
    addIfPresent(metrics, metricServiceName(fileName), `metrics/${fileName}`)
  }

  const profiles = {}
  for (const fileName of profileFiles) {
    const svc = cpuProfileServiceName(fileName)
    if (svc) profiles[svc] = { ...(profiles[svc] ?? {}), cpu: `profiles/${fileName}` }
  }

  const traces = {}
  for (const fileName of traceFiles) {
    addIfPresent(traces, traceServiceName(fileName), `traces/${fileName}`)
  }

  const services = [...new Set([
    ...Object.keys(metrics),
    ...Object.keys(profiles),
    ...Object.keys(traces),
  ])].sort()

  const manifest = {
    ts,
    duration_ms: null,
    services,
    metrics,
    profiles,
    traces,
  }

  try {
    await stat(join(runDir, 'summary.json'))
    manifest.summary = 'summary.json'
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
  }

  return manifest
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (urlPath === '/node_modules/@vt/perf-analysis/profile-reducer.mjs') {
    await servePackageExport(res, '@vt/perf-analysis/profile-reducer.mjs')
    return
  }

  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const target = resolve(ROOT, normalize(rel))
  if (!isWithin(ROOT, target)) {
    sendText(res, 403, 'forbidden')
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
    sendText(res, 404, 'not found')
  }
}

async function servePackageExport(res, specifier) {
  let target
  try {
    target = fileURLToPath(import.meta.resolve(specifier))
  } catch {
    sendText(res, 404, 'not found')
    return
  }

  try {
    const buf = await readFile(target)
    const ext = extname(target).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(buf)
  } catch {
    sendText(res, 404, 'not found')
  }
}

async function serveRunFile(req, res, ts) {
  const runDir = runDirForTs(ts)
  if (!runDir) {
    sendText(res, 403, 'forbidden', { 'Access-Control-Allow-Origin': '*' })
    return
  }

  const url = new URL(req.url, 'http://x')
  const relPath = url.searchParams.get('path') ?? ''
  const target = resolve(runDir, normalize(relPath))
  if (!relPath || !isWithin(runDir, target)) {
    sendText(res, 403, 'forbidden', { 'Access-Control-Allow-Origin': '*' })
    return
  }

  try {
    const st = await stat(target)
    if (!st.isFile()) {
      sendText(res, 404, 'not found', { 'Access-Control-Allow-Origin': '*' })
      return
    }

    const ext = extname(target).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    })
    createReadStream(target).pipe(res)
  } catch (err) {
    if (err?.code === 'ENOENT') {
      sendText(res, 404, 'not found', { 'Access-Control-Allow-Origin': '*' })
      return
    }
    throw err
  }
}

export function createPerfDashboardServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x')
      const manifestMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/manifest$/)
      const fileMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/file$/)

      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }

      if (url.pathname === '/api/runs') {
        sendJson(res, 200, await listRuns())
        return
      }

      if (manifestMatch) {
        const manifest = await buildManifest(decodeURIComponent(manifestMatch[1]))
        if (!manifest) {
          sendJson(res, 404, { error: 'run not found' })
          return
        }
        sendJson(res, 200, manifest)
        return
      }

      if (fileMatch) {
        await serveRunFile(req, res, decodeURIComponent(fileMatch[1]))
        return
      }

      await serveStatic(req, res)
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message ?? err) })
    }
  })
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = err => {
      server.off('listening', onListening)
      rejectListen(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolveListen(server.address())
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })
}

export async function startPerfDashboard({ requestedPort = process.env.PORT, runTs = null } = {}) {
  const firstPort = Number(requestedPort ?? DEFAULT_PORT)
  for (let port = firstPort; port < firstPort + 50; port++) {
    const server = createPerfDashboardServer()
    try {
      const address = await listen(server, port)
      const baseUrl = `http://${HOST}:${address.port}`
      const runUrl = runTs ? `${baseUrl}/#run=${encodeURIComponent(runTs)}` : baseUrl
      console.log(`perf-dashboard serving at ${baseUrl}`)
      if (runTs) console.log(`selected run: ${runUrl}`)
      return { server, url: baseUrl, runUrl }
    } catch (err) {
      if (err?.code !== 'EADDRINUSE') throw err
    }
  }
  throw new Error(`No free port found from ${firstPort} to ${firstPort + 49}`)
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  const runTs = process.argv.slice(2).find(arg => !arg.startsWith('-')) ?? null
  startPerfDashboard({ runTs }).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
