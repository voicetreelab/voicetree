import { describe, expect, it } from 'vitest'

import { parseArgs } from '../src/commands/screenshot'

describe('parseArgs', () => {
  it.each(['--out', '--output', '-o'])('parses %s as the screenshot output path', flag => {
    expect(parseArgs([flag, '/tmp/custom-shot.png'])).toMatchObject({
      outPath: '/tmp/custom-shot.png',
      base64: false,
      fullPage: true,
    })
  })

  it('leaves outPath unset when no explicit output flag is provided', () => {
    expect(parseArgs([]).outPath).toBeUndefined()
  })
})
