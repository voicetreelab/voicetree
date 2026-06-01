import { describe, expect, test } from 'vitest'
import {
  classifyAddReadPathResult,
  classifyRemoveReadPathResult,
  classifySetWriteFolderPathResult,
  composeReadPathsResponse,
  composeProjectState,
  composeWriteFolderPathResponse,
  decodeProjectPath,
} from '../handleProject.ts'

describe('handleProject', () => {
  test('decodes valid project path parameters', () => {
    expect(decodeProjectPath(encodeURIComponent('/tmp/project/docs'))).toEqual({
      ok: true,
      decoded: '/tmp/project/docs',
    })
  })

  test('returns a typed encoding error for malformed project path parameters', () => {
    expect(decodeProjectPath('%FF')).toEqual({
      ok: false,
      error: 'Invalid encoded path',
      code: 'INVALID_PATH_ENCODING',
    })
  })

  test('composes project state using configured write path when present', () => {
    expect(composeProjectState({
      projectRoot: '/tmp/project',
      readPaths: ['/tmp/project/docs'],
      writeFolderPathOption: { value: '/tmp/project/out' },
    })).toEqual({
      projectRoot: '/tmp/project',
      readPaths: ['/tmp/project/docs'],
      writeFolderPath: '/tmp/project/out',
    })
  })

  test('composes project state using project path when write path is absent', () => {
    expect(composeProjectState({
      projectRoot: '/tmp/project',
      readPaths: [],
      writeFolderPathOption: { value: null },
    })).toEqual({
      projectRoot: '/tmp/project',
      readPaths: [],
      writeFolderPath: '/tmp/project',
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
    expect(composeReadPathsResponse(['/tmp/project/docs'])).toEqual({
      readPaths: ['/tmp/project/docs'],
    })
    expect(composeWriteFolderPathResponse('/tmp/project/out')).toEqual({
      writeFolderPath: '/tmp/project/out',
    })
  })
})
