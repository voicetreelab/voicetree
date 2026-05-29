#!/usr/bin/env node
// Standalone fake vt-graphd for graph-db-client black-box tests. Mirrors
// the BF-343 owner protocol just enough to exercise ensureGraphDaemonForProject
// without depending on graph-db-server internals: atomic-create the owner
// record under <project>/.voicetree/, bind a loopback HTTP server, atomic-
// replace the owner record with the bound port, serve /health with a
// HealthResponse-shaped JSON body, and clean up on SIGTERM/SIGINT.
//
// Recognised env vars (set by tests):
//   FAKE_VT_GRAPHD_STARTUP_DELAY_MS - delay between claim and bind
//   FAKE_VT_GRAPHD_HEALTH_OWNER_NONCE - override the /health owner.nonce
//   FAKE_VT_GRAPHD_HEALTH_CANONICAL_PROJECT - override owner.canonicalProject
//   FAKE_VT_GRAPHD_HEALTH_OWNER_NULL=1 - serve /health with owner=null

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const projectIndex = args.indexOf('--project-root')
if (projectIndex === -1 || !args[projectIndex + 1]) {
  process.stderr.write('fake-vt-graphd: missing --project-root\n')
  process.exit(1)
}
const project = args[projectIndex + 1]
const ownerPath = join(project, '.voicetree', 'graphd.owner.json')
const startedAtMs = Date.now()
const ownerNonce = randomUUID()
const baseRecord = {
  schemaVersion: 1,
  daemonKind: 'graphd',
  canonicalProject: project,
  pid: process.pid,
  ppid: process.ppid ?? 0,
  port: null,
  ownerNonce,
  startedAtMs,
  heartbeatAtMs: startedAtMs,
  callerKind: 'test',
  contractVersion: '0.2.0',
  commandFingerprint: {
    executable: process.argv[0],
    args: process.argv.slice(1),
  },
}

async function atomicCreateOwner(record) {
  try {
    await writeFile(ownerPath, `${JSON.stringify(record, null, 2)}\n`, {
      flag: 'wx',
    })
    return true
  } catch (err) {
    if (err && err.code === 'EEXIST') return false
    throw err
  }
}

async function atomicReplaceOwner(record) {
  const tmp = `${ownerPath}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  try {
    await rename(tmp, ownerPath)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

async function deleteOwner() {
  await unlink(ownerPath).catch((err) => {
    if (err && err.code !== 'ENOENT') throw err
  })
}

const created = await atomicCreateOwner(baseRecord)
if (!created) {
  // Lost the race — exit cleanly so the test harness sees one healthy
  // owner from the winner.
  process.exit(0)
}

const startupDelayMs = Number(process.env.FAKE_VT_GRAPHD_STARTUP_DELAY_MS) || 0
if (startupDelayMs > 0) {
  await new Promise((res) => setTimeout(res, startupDelayMs))
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const ownerOverrideNull =
      process.env.FAKE_VT_GRAPHD_HEALTH_OWNER_NULL === '1'
    const reportedNonce =
      process.env.FAKE_VT_GRAPHD_HEALTH_OWNER_NONCE ?? ownerNonce
    const reportedProject =
      process.env.FAKE_VT_GRAPHD_HEALTH_CANONICAL_PROJECT ?? project
    const body = {
      version: '0.2.0',
      project,
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      sessionCount: 0,
      owner: ownerOverrideNull
        ? null
        : {
            schemaVersion: 1,
            canonicalProject: reportedProject,
            pid: process.pid,
            ppid: process.ppid ?? 0,
            port: server.address().port,
            ownerNonce: reportedNonce,
            contractVersion: '0.2.0',
          },
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }
  res.writeHead(404)
  res.end()
})

await new Promise((res) => server.listen(0, '127.0.0.1', res))
const boundPort = server.address().port
await atomicReplaceOwner({ ...baseRecord, port: boundPort })

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await deleteOwner()
  server.close(() => process.exit(0))
  // Force exit if close hangs on stuck connections.
  setTimeout(() => process.exit(0), 200).unref()
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
