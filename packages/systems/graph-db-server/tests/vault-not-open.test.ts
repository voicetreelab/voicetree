import { describe, expect, test } from 'vitest'

import {
  VaultNotOpenError,
  VaultOpenFailedError,
} from '../src/application/errors/vaultNotOpen.ts'

const LEGACY_MESSAGE_PATTERN = /no vault.*open|watched directory not initialized/i

describe('structured vault lifecycle errors', () => {
  test('VaultNotOpenError serializes as a structured 409 without legacy wording', () => {
    const error = new VaultNotOpenError()

    expect(error.status).toBe(409)
    expect(error.code).toBe('vault_not_open')
    expect(error.toResponseBody()).toEqual({
      error: {
        code: 'vault_not_open',
        message: 'A vault must be opened before using this endpoint',
      },
    })
    expect(error.message).not.toMatch(LEGACY_MESSAGE_PATTERN)
  })

  test('VaultOpenFailedError serializes with a distinct code', () => {
    const error = new VaultOpenFailedError('resource failed')

    expect(error.status).toBe(409)
    expect(error.code).toBe('vault_open_failed')
    expect(error.toResponseBody()).toEqual({
      error: {
        code: 'vault_open_failed',
        message: 'resource failed',
      },
    })
  })
})
