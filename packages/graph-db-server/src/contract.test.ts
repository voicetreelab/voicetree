import { describe, test, expect } from 'vitest'
import {
  HealthResponseSchema,
  ShutdownResponseSchema,
  CONTRACT_VERSION,
  type HealthResponse,
  type ShutdownResponse,
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
})
