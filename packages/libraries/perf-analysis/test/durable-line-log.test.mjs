import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { createDurableLineLog } from '../src/durable-line-log.mjs'

describe('createDurableLineLog', () => {
  test('appends complete newline-terminated records and closes idempotently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vt-durable-line-log-'))
    const path = join(dir, 'service.log')
    const log = createDurableLineLog(path)

    log.writeLine('first')
    log.writeLine('second')
    log.close()
    log.close()

    await expect(readFile(path, 'utf8')).resolves.toBe('first\nsecond\n')
  })

  test('refuses writes after close', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vt-durable-line-log-'))
    const log = createDurableLineLog(join(dir, 'service.log'))

    log.close()

    expect(() => log.writeLine('too late')).toThrow(/durable log is closed/)
  })
})
