import { describe, expect, test } from 'vitest'

import {
  ProjectNotOpenError,
  ProjectOpenFailedError,
} from '../src/application/errors/projectNotOpen.ts'

const LEGACY_MESSAGE_PATTERN = /no project.*open|watched directory not initialized/i

describe('structured project lifecycle errors', () => {
  test('ProjectNotOpenError serializes as a structured 409 without legacy wording', () => {
    const error = new ProjectNotOpenError()

    expect(error.status).toBe(409)
    expect(error.code).toBe('project_not_open')
    expect(error.toResponseBody()).toEqual({
      error: {
        code: 'project_not_open',
        message: 'A project must be opened before using this endpoint',
      },
    })
    expect(error.message).not.toMatch(LEGACY_MESSAGE_PATTERN)
  })

  test('ProjectOpenFailedError serializes with a distinct code', () => {
    const error = new ProjectOpenFailedError('resource failed')

    expect(error.status).toBe(409)
    expect(error.code).toBe('project_open_failed')
    expect(error.toResponseBody()).toEqual({
      error: {
        code: 'project_open_failed',
        message: 'resource failed',
      },
    })
  })
})
