import { describe, expect, test } from 'vitest'

import {
  CALLER_KINDS,
  commandFingerprintsEqual,
  isCallerKind,
  isOwnerRecord,
  OWNER_RECORD_SCHEMA_VERSION,
  type CommandFingerprint,
  type OwnerRecord,
} from '../autoLaunch/ownerRecord.ts'

function fingerprint(
  overrides: Partial<CommandFingerprint> = {},
): CommandFingerprint {
  return {
    executable: '/usr/local/bin/node',
    args: ['vt-graphd', '--vault', '/vault'],
    ...overrides,
  }
}

function ownerRecord(overrides: Partial<OwnerRecord> = {}): OwnerRecord {
  return {
    schemaVersion: OWNER_RECORD_SCHEMA_VERSION,
    canonicalVaultPath: '/vault',
    pid: 4242,
    ppid: 1,
    port: 65123,
    ownerNonce: 'nonce-abc',
    startedAtMs: 1_000_000,
    heartbeatAtMs: 1_000_500,
    callerKind: 'electron',
    contractVersion: '0.2.0',
    commandFingerprint: fingerprint(),
    ...overrides,
  }
}

describe('commandFingerprintsEqual', () => {
  test('returns true for identical fingerprints', () => {
    expect(commandFingerprintsEqual(fingerprint(), fingerprint())).toBe(true)
  })

  test('returns false when executable differs', () => {
    expect(
      commandFingerprintsEqual(
        fingerprint(),
        fingerprint({ executable: '/usr/bin/python' }),
      ),
    ).toBe(false)
  })

  test('returns false when arg length differs', () => {
    expect(
      commandFingerprintsEqual(fingerprint(), fingerprint({ args: [] })),
    ).toBe(false)
  })

  test('returns false when arg content differs', () => {
    expect(
      commandFingerprintsEqual(
        fingerprint(),
        fingerprint({ args: ['vt-graphd', '--vault', '/other-vault'] }),
      ),
    ).toBe(false)
  })
})

describe('isCallerKind', () => {
  test.each(CALLER_KINDS)('accepts %s', (kind) => {
    expect(isCallerKind(kind)).toBe(true)
  })

  test('rejects unknown strings', () => {
    expect(isCallerKind('renderer')).toBe(false)
    expect(isCallerKind('')).toBe(false)
  })

  test('rejects non-strings', () => {
    expect(isCallerKind(42)).toBe(false)
    expect(isCallerKind(null)).toBe(false)
    expect(isCallerKind(undefined)).toBe(false)
  })
})

describe('isOwnerRecord', () => {
  test('accepts a well-formed record', () => {
    expect(isOwnerRecord(ownerRecord())).toBe(true)
  })

  test('accepts a record whose port is null (claim before port bind)', () => {
    expect(isOwnerRecord(ownerRecord({ port: null }))).toBe(true)
  })

  test('rejects an unknown schema version', () => {
    expect(isOwnerRecord({ ...ownerRecord(), schemaVersion: 2 })).toBe(false)
  })

  test('rejects a missing canonical vault path', () => {
    const r = { ...ownerRecord() } as Record<string, unknown>
    delete r.canonicalVaultPath
    expect(isOwnerRecord(r)).toBe(false)
  })

  test('rejects a non-integer pid', () => {
    expect(isOwnerRecord({ ...ownerRecord(), pid: 12.5 })).toBe(false)
  })

  test('rejects a zero or negative pid', () => {
    expect(isOwnerRecord({ ...ownerRecord(), pid: 0 })).toBe(false)
    expect(isOwnerRecord({ ...ownerRecord(), pid: -1 })).toBe(false)
  })

  test('rejects an out-of-range port', () => {
    expect(isOwnerRecord({ ...ownerRecord(), port: 70_000 })).toBe(false)
    expect(isOwnerRecord({ ...ownerRecord(), port: -1 })).toBe(false)
  })

  test('rejects an empty owner nonce', () => {
    expect(isOwnerRecord({ ...ownerRecord(), ownerNonce: '' })).toBe(false)
  })

  test('rejects an unknown caller kind', () => {
    expect(isOwnerRecord({ ...ownerRecord(), callerKind: 'renderer' })).toBe(
      false,
    )
  })

  test('rejects a malformed command fingerprint', () => {
    expect(
      isOwnerRecord({
        ...ownerRecord(),
        commandFingerprint: { executable: 'node', args: [123] },
      }),
    ).toBe(false)
  })

  test('rejects non-objects', () => {
    expect(isOwnerRecord(null)).toBe(false)
    expect(isOwnerRecord('owner')).toBe(false)
    expect(isOwnerRecord(42)).toBe(false)
  })
})
