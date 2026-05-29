import { describe, expect, test } from 'vitest'
import {
  classifyAddReadPathResult,
  classifyRemoveReadPathResult,
  classifySetWriteFolderPathResult,
  composeReadPathsResponse,
  composeVaultState,
  composeWriteFolderPathResponse,
  decodeVaultPath,
} from '../handleVault.ts'

describe('handleVault', () => {
  test('decodes valid vault path parameters', () => {
    expect(decodeVaultPath(encodeURIComponent('/tmp/vault/docs'))).toEqual({
      ok: true,
      decoded: '/tmp/vault/docs',
    })
  })

  test('returns a typed encoding error for malformed vault path parameters', () => {
    expect(decodeVaultPath('%FF')).toEqual({
      ok: false,
      error: 'Invalid encoded path',
      code: 'INVALID_PATH_ENCODING',
    })
  })

  test('composes vault state using configured write path when present', () => {
    expect(composeVaultState({
      projectRoot: '/tmp/vault',
      readPaths: ['/tmp/vault/docs'],
      writeFolderPathOption: { value: '/tmp/vault/out' },
    })).toEqual({
      projectRoot: '/tmp/vault',
      readPaths: ['/tmp/vault/docs'],
      writeFolderPath: '/tmp/vault/out',
    })
  })

  test('composes vault state using vault path when write path is absent', () => {
    expect(composeVaultState({
      projectRoot: '/tmp/vault',
      readPaths: [],
      writeFolderPathOption: { value: null },
    })).toEqual({
      projectRoot: '/tmp/vault',
      readPaths: [],
      writeFolderPath: '/tmp/vault',
    })
  })

  test.each([
    {
      result: { success: true },
      expected: { kind: 'success' },
    },
    {
      result: { success: false, error: 'Path already in readPaths' },
      expected: { kind: 'idempotent-success' },
    },
    {
      result: { success: false, error: 'Path already expanded' },
      expected: { kind: 'idempotent-success' },
    },
    {
      result: { success: false, error: 'disk denied' },
      expected: {
        kind: 'error',
        message: 'disk denied',
        code: 'ADD_READ_PATH_FAILED',
        status: 500,
      },
    },
  ])('classifies add read path result %#', ({ result, expected }) => {
    expect(classifyAddReadPathResult(result)).toEqual(expected)
  })

  test.each([
    {
      result: { success: true },
      expected: { kind: 'success' },
    },
    {
      result: { success: false, error: 'Cannot remove write path' },
      expected: {
        kind: 'error',
        message: 'Cannot remove write path',
        code: 'CANNOT_REMOVE_WRITE_PATH',
        status: 400,
      },
    },
    {
      result: { success: false, error: 'not mounted' },
      expected: {
        kind: 'error',
        message: 'not mounted',
        code: 'REMOVE_READ_PATH_FAILED',
        status: 500,
      },
    },
  ])('classifies remove read path result %#', ({ result, expected }) => {
    expect(classifyRemoveReadPathResult(result)).toEqual(expected)
  })

  test.each([
    {
      result: { success: true },
      expected: { kind: 'success' },
    },
    {
      result: { success: false, error: 'not writable' },
      expected: {
        kind: 'error',
        message: 'not writable',
        code: 'SET_WRITE_PATH_FAILED',
        status: 500,
      },
    },
  ])('classifies set write path result %#', ({ result, expected }) => {
    expect(classifySetWriteFolderPathResult(result)).toEqual(expected)
  })

  test('composes schema-valid read and write path responses', () => {
    expect(composeReadPathsResponse(['/tmp/vault/docs'])).toEqual({
      readPaths: ['/tmp/vault/docs'],
    })
    expect(composeWriteFolderPathResponse('/tmp/vault/out')).toEqual({
      writeFolderPath: '/tmp/vault/out',
    })
  })
})
