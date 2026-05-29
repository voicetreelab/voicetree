#!/usr/bin/env node
// Standalone fake vt-daemon (VTD) for vt-daemon-client black-box tests.
// Mirrors the BF-371 binary contract just enough to exercise
// ensureVtDaemonForVault without booting the real binary's tmux + agent
// runtime + graphd subprocess. The protocol invariants this fixture must
// honor:
//
//   1. Parse `--vault <path>` (BF-371's required flag — NOT `--project-root`).
//   2. Atomic-create the owner record at
//      `<vault>/.voicetree/vtd.owner.json` with port=null. Lost-race exit 0.
//   3. Bind a loopback HTTP server.
//   4. Atomic-replace the owner record with the bound port.
//   5. Write `<vault>/.voicetree/rpc.port` and `<vault>/.voicetree/auth-token`
//      (BF-371 §7: the rpc.port + auth-token files are the cwd-upwalk
//      discovery contract for hook subprocesses and spawned agents).
//   6. Serve `GET /health` with a `VtDaemonHealthResponse`-shaped body
//      (the BF-372 schema lives in @vt/graph-db-protocol).
//   7. On SIGTERM/SIGINT delete rpc.port + owner record and exit 0.
//
// BF-374 extends this fixture with adversarial env vars used by the
// storm / stale / unsafe-owner / cooldown regression suites. The happy-
// path (Leaf E's six BF-373 tests) is preserved: every adversarial knob
// is opt-in via env var with the same default as the unmodified fixture.
//
// Recognised env vars (mirror fake-vt-graphd.mjs's surface):
//   FAKE_VTD_STARTUP_DELAY_MS         — sleep between owner-claim and HTTP bind.
//   FAKE_VTD_HEALTH_OWNER_NONCE       — override /health body's owner.ownerNonce.
//   FAKE_VTD_HEALTH_CANONICAL_VAULT   — override /health body's owner.canonicalVault.
//   FAKE_VTD_HEALTH_OWNER_NULL=1      — serve /health with owner: null.
//   FAKE_VTD_EXIT_CODE                — exit immediately with the given code,
//                                       BEFORE claiming the record (drives the
//                                       BF-347 cooldown-on-spawn-failure path).
//
// The `.mjs` extension matches the graphd fake-vt-graphd.mjs sibling and
// keeps vitest from picking up this file as a test.

import { createServer } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import {
  chmod,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const vaultIndex = args.indexOf('--vault')
if (vaultIndex === -1 || !args[vaultIndex + 1]) {
  process.stderr.write('fake-vtd: missing --vault\n')
  process.exit(1)
}
const vault = resolve(args[vaultIndex + 1])
const ownerPath = join(vault, '.voicetree', 'vtd.owner.json')
const portPath = join(vault, '.voicetree', 'rpc.port')
const authTokenPath = join(vault, '.voicetree', 'auth-token')
const envSnapshotPath = process.env.FAKE_VTD_ENV_SNAPSHOT_PATH

if (envSnapshotPath) {
  await writeFile(
    envSnapshotPath,
    `${JSON.stringify({
      VOICETREE_APP_SUPPORT: process.env.VOICETREE_APP_SUPPORT ?? null,
      VT_DAEMON_BIN: process.env.VT_DAEMON_BIN ?? null,
    }, null, 2)}\n`,
    'utf8',
  )
}

// BF-374: failed-spawn knob. Tested via the cooldown suite. Fires BEFORE
// the owner record is created so the ensure caller sees a child that
// exits without ever publishing identity — i.e. the exact precondition
// the BF-347 cooldown breadcrumb writer is supposed to handle.
const fakeExitCodeRaw = process.env.FAKE_VTD_EXIT_CODE
if (fakeExitCodeRaw !== undefined && fakeExitCodeRaw !== '') {
  const code = Number(fakeExitCodeRaw)
  process.exit(Number.isFinite(code) ? code : 1)
}

const startedAtMs = Date.now()
const ownerNonce = randomUUID()
const authToken = randomBytes(32).toString('base64url')
// VTD's contract version is its own (decoupled from graphd's). Mirrors
// `packages/systems/vt-daemon/src/contract.ts::VTD_CONTRACT_VERSION`.
const VTD_CONTRACT_VERSION = '0.1.0'

const baseRecord = {
  schemaVersion: 1,
  daemonKind: 'vtd',
  canonicalVault: vault,
  pid: process.pid,
  ppid: process.ppid ?? 0,
  port: null,
  ownerNonce,
  startedAtMs,
  heartbeatAtMs: startedAtMs,
  callerKind: 'test',
  contractVersion: VTD_CONTRACT_VERSION,
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

async function deletePortFile() {
  await unlink(portPath).catch((err) => {
    if (err && err.code !== 'ENOENT') throw err
  })
}

const created = await atomicCreateOwner(baseRecord)
if (!created) {
  // Lost the claim race — exit cleanly so the test harness sees one
  // healthy owner from the winner.
  process.exit(0)
}

// BF-374: simulate slow startup between the owner-record claim (port=null)
// and the HTTP bind. Concurrent ensure callers observing the port-null
// record must route to `wait`, not stampede a second spawn.
const startupDelayMs = Number(process.env.FAKE_VTD_STARTUP_DELAY_MS) || 0
if (startupDelayMs > 0) {
  await new Promise((res) => setTimeout(res, startupDelayMs))
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const bound = server.address()
    const port = bound && typeof bound === 'object' ? bound.port : null
    // BF-374: identity overrides drive the unsafe-owner refusal +
    // nonce-mismatch reclaim suites. Defaults preserve Leaf E's six
    // happy-path tests untouched.
    const ownerOverrideNull =
      process.env.FAKE_VTD_HEALTH_OWNER_NULL === '1'
    const reportedNonce =
      process.env.FAKE_VTD_HEALTH_OWNER_NONCE ?? ownerNonce
    const reportedVault =
      process.env.FAKE_VTD_HEALTH_CANONICAL_VAULT ?? vault
    const body = {
      version: VTD_CONTRACT_VERSION,
      vault,
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      daemonKind: 'vtd',
      owner:
        port === null || ownerOverrideNull
          ? null
          : {
              schemaVersion: 1,
              canonicalVault: reportedVault,
              pid: process.pid,
              ppid: process.ppid ?? 0,
              port,
              ownerNonce: reportedNonce,
              contractVersion: VTD_CONTRACT_VERSION,
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

// Write auth-token BEFORE the owner record carries the port, so a reader
// that sees the port in the owner record is guaranteed to find the token
// on disk (the BF-371 contract — auth-token first, then port file, then
// owner record's port). Mode 0600 to match the real binary.
await writeFile(authTokenPath, authToken, { encoding: 'utf8' })
await chmod(authTokenPath, 0o600).catch(() => {})

await writeFile(portPath, `${boundPort}\n`, 'utf8')

await atomicReplaceOwner({ ...baseRecord, port: boundPort })

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await deletePortFile()
  await deleteOwner()
  server.close(() => process.exit(0))
  // Force exit if close hangs on stuck connections.
  setTimeout(() => process.exit(0), 200).unref()
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
