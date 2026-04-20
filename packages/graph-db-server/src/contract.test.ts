import { describe, test, expect } from 'vitest'
import {
  HealthResponseSchema,
  ShutdownResponseSchema,
  CONTRACT_VERSION,
  SessionCreateResponseSchema,
  SessionInfoSchema,
  type HealthResponse,
  type ShutdownResponse,
  type SessionCreateResponse,
  type SessionInfo,
} from './contract.ts'

describe('contract', () => {
  test('CONTRACT_VERSION is 0.1.0', () => {
    expect(CONTRACT_VERSION).toBe('0.1.0')
  })

  test('HealthResponse round-trips a valid sample', () => {
    const sample: HealthResponse = {
      version: CONTRACT_VERSION,
      vault: '/tmp/vault',
      uptimeSeconds: 42,
      sessionCount: 0,
    }
    const parsed = HealthResponseSchema.parse(sample)
    expect(parsed).toEqual(sample)
  })

  test('HealthResponse rejects missing required fields', () => {
    expect(() => HealthResponseSchema.parse({ version: '0.1.0' })).toThrow()
    expect(() =>
      HealthResponseSchema.parse({
        version: '0.1.0',
        vault: '/tmp/v',
        uptimeSeconds: 1,
      }),
    ).toThrow()
  })

  test('HealthResponse rejects wrong types', () => {
    expect(() =>
      HealthResponseSchema.parse({
        version: '0.1.0',
        vault: '/tmp/v',
        uptimeSeconds: 'forty',
        sessionCount: 0,
      }),
    ).toThrow()
  })

  test('HealthResponse rejects negative uptime / sessionCount', () => {
    expect(() =>
      HealthResponseSchema.parse({
        version: '0.1.0',
        vault: '/tmp/v',
        uptimeSeconds: -1,
        sessionCount: 0,
      }),
    ).toThrow()
    expect(() =>
      HealthResponseSchema.parse({
        version: '0.1.0',
        vault: '/tmp/v',
        uptimeSeconds: 1,
        sessionCount: -1,
      }),
    ).toThrow()
  })

  test('ShutdownResponse round-trips a valid sample', () => {
    const sample: ShutdownResponse = { ok: true }
    const parsed = ShutdownResponseSchema.parse(sample)
    expect(parsed).toEqual(sample)
  })

  test('ShutdownResponse rejects missing ok', () => {
    expect(() => ShutdownResponseSchema.parse({})).toThrow()
  })

  test('ShutdownResponse rejects ok !== true literal', () => {
    expect(() => ShutdownResponseSchema.parse({ ok: false })).toThrow()
  })

  test('SessionCreateResponse round-trips a valid sample', () => {
    const sample: SessionCreateResponse = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    }
    const parsed = SessionCreateResponseSchema.parse(sample)
    expect(parsed).toEqual(sample)
  })

  test('SessionInfo round-trips a valid sample', () => {
    const sample: SessionInfo = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      lastAccessedAt: 42,
      collapseSetSize: 1,
      selectionSize: 2,
    }
    const parsed = SessionInfoSchema.parse(sample)
    expect(parsed).toEqual(sample)
  })

  test('Session schemas reject invalid ids and negative counts', () => {
    expect(() =>
      SessionCreateResponseSchema.parse({ sessionId: 'not-a-uuid' }),
    ).toThrow()
    expect(() =>
      SessionInfoSchema.parse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        lastAccessedAt: -1,
        collapseSetSize: 0,
        selectionSize: 0,
      }),
    ).toThrow()
  })
})
