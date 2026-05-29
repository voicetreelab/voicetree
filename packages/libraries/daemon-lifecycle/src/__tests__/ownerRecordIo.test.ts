import { describe, expect, test } from 'vitest'

import {
  ownerRecordFile,
  type CommandFingerprint,
  type OwnerRecord,
} from '@vt/graph-db-protocol'

function fingerprint(
  overrides: Partial<CommandFingerprint> = {},
): CommandFingerprint {
  return {
    executable: '/usr/local/bin/node',
    args: ['vt-graphd', '--project-root', '/project'],
    ...overrides,
  }
}

function validOwnerRecord(overrides: Partial<OwnerRecord> = {}): OwnerRecord {
  return ownerRecordFile.create({
    daemonKind: 'graphd',
    canonicalProject: '/project',
    pid: 4242,
    ppid: 1,
    callerKind: 'electron',
    contractVersion: '0.2.0',
    commandFingerprint: fingerprint(),
    nowMs: 1_000_000,
    ownerNonce: 'nonce-abc',
    ...overrides,
  })
}

function encodeWithOverrides(overrides: Record<string, unknown>): string {
  // Bypass the typed `create` builder to construct a deliberately malformed
  // record for decode-rejection black-box tests. The validator inside
  // `decode` is implementation; we only assert on the observable outcome
  // (returns null for malformed input).
  return JSON.stringify({
    ...validOwnerRecord(),
    ...overrides,
  })
}

describe('ownerRecordFile.create', () => {
  test('stamps the current schema version on every record', () => {
    const record = validOwnerRecord()
    expect(record.schemaVersion).toBe(1)
  })

  test('starts records with a null port until the daemon binds', () => {
    const record = ownerRecordFile.create({
      daemonKind: 'graphd',
      canonicalProject: '/project',
      pid: 4242,
      ppid: 1,
      callerKind: 'electron',
      contractVersion: '0.2.0',
      commandFingerprint: fingerprint(),
      nowMs: 1_000_000,
    })
    expect(record.port).toBeNull()
  })

  test('uses the caller-supplied nonce when provided', () => {
    const record = validOwnerRecord({ ownerNonce: 'fixed-nonce' })
    expect(record.ownerNonce).toBe('fixed-nonce')
  })

  test('produces a fresh nonce when none is supplied', () => {
    const a = ownerRecordFile.create({
      daemonKind: 'graphd',
      canonicalProject: '/project',
      pid: 4242,
      ppid: 1,
      callerKind: 'electron',
      contractVersion: '0.2.0',
      commandFingerprint: fingerprint(),
      nowMs: 1_000_000,
    })
    const b = ownerRecordFile.create({
      daemonKind: 'graphd',
      canonicalProject: '/project',
      pid: 4242,
      ppid: 1,
      callerKind: 'electron',
      contractVersion: '0.2.0',
      commandFingerprint: fingerprint(),
      nowMs: 1_000_000,
    })
    expect(a.ownerNonce).not.toBe(b.ownerNonce)
  })
})

describe('ownerRecordFile.encode / decode roundtrip', () => {
  test('encode then decode preserves a valid record', () => {
    const original = validOwnerRecord()
    const roundTripped = ownerRecordFile.decode(ownerRecordFile.encode(original))
    expect(roundTripped).toEqual(original)
  })

  test('decode accepts a port-less record (claim before port bind)', () => {
    const original = validOwnerRecord({ port: null })
    expect(ownerRecordFile.decode(ownerRecordFile.encode(original))).toEqual(
      original,
    )
  })

  test('encoded form has a trailing newline (POSIX file convention)', () => {
    const encoded = ownerRecordFile.encode(validOwnerRecord())
    expect(encoded.endsWith('\n')).toBe(true)
  })
})

describe('ownerRecordFile.decode rejection', () => {
  test('returns null on invalid JSON', () => {
    expect(ownerRecordFile.decode('not-json')).toBeNull()
    expect(ownerRecordFile.decode('')).toBeNull()
  })

  test('returns null when schema version is unknown', () => {
    expect(ownerRecordFile.decode(encodeWithOverrides({ schemaVersion: 2 }))).toBeNull()
  })

  test('returns null when canonical project path is missing', () => {
    expect(
      ownerRecordFile.decode(
        JSON.stringify({
          ...validOwnerRecord(),
          canonicalProject: undefined,
        }),
      ),
    ).toBeNull()
  })

  test('returns null when daemonKind is missing or unknown', () => {
    expect(
      ownerRecordFile.decode(
        JSON.stringify({
          ...validOwnerRecord(),
          daemonKind: undefined,
        }),
      ),
    ).toBeNull()
    expect(
      ownerRecordFile.decode(encodeWithOverrides({ daemonKind: 'unknown' })),
    ).toBeNull()
  })

  test('returns null on a non-integer pid', () => {
    expect(ownerRecordFile.decode(encodeWithOverrides({ pid: 12.5 }))).toBeNull()
  })

  test('returns null on a zero or negative pid', () => {
    expect(ownerRecordFile.decode(encodeWithOverrides({ pid: 0 }))).toBeNull()
    expect(ownerRecordFile.decode(encodeWithOverrides({ pid: -1 }))).toBeNull()
  })

  test('returns null on an out-of-range port', () => {
    expect(ownerRecordFile.decode(encodeWithOverrides({ port: 70_000 }))).toBeNull()
    expect(ownerRecordFile.decode(encodeWithOverrides({ port: -1 }))).toBeNull()
  })

  test('returns null when the owner nonce is empty', () => {
    expect(ownerRecordFile.decode(encodeWithOverrides({ ownerNonce: '' }))).toBeNull()
  })

  test('returns null on an unknown caller kind', () => {
    expect(
      ownerRecordFile.decode(encodeWithOverrides({ callerKind: 'renderer' })),
    ).toBeNull()
  })

  test('returns null on a malformed command fingerprint', () => {
    expect(
      ownerRecordFile.decode(
        encodeWithOverrides({
          commandFingerprint: { executable: 'node', args: [123] },
        }),
      ),
    ).toBeNull()
  })

  test('returns null on non-object roots', () => {
    expect(ownerRecordFile.decode('null')).toBeNull()
    expect(ownerRecordFile.decode('"owner"')).toBeNull()
    expect(ownerRecordFile.decode('42')).toBeNull()
  })
})
