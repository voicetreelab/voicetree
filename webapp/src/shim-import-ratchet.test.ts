import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const srcDir: string = path.dirname(fileURLToPath(import.meta.url))
const webappDir: string = path.resolve(srcDir, '..')

const ALLOWED_NON_SHIM_PATHS: ReadonlySet<string> = new Set([
  '@/shell/edge/main/graph/watch_folder/watchFolder',
])

interface ShimImport {
  readonly file: string
  readonly specifier: string
}

function findShimImports(): ReadonlyArray<ShimImport> {
  const output: string = execFileSync(
    'grep',
    [
      '-rnE',
      '--include=*.ts',
      '--include=*.tsx',
      "from ['\"]@/shell/edge/main/graph/",
      'src',
    ],
    { cwd: webappDir, encoding: 'utf-8' },
  )

  const seen: Set<string> = new Set()
  const matches: ShimImport[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const firstColon: number = line.indexOf(':')
    const secondColon: number = line.indexOf(':', firstColon + 1)
    if (firstColon === -1 || secondColon === -1) continue

    const file: string = line.slice(0, firstColon)
    const content: string = line.slice(secondColon + 1)

    if (file.startsWith('src/shell/edge/main/graph/')) continue

    const specMatch: RegExpMatchArray | null = content.match(
      /from ['"](@\/shell\/edge\/main\/graph\/[^'"]+)['"]/,
    )
    if (!specMatch?.[1]) continue
    const specifier: string = specMatch[1]

    if (ALLOWED_NON_SHIM_PATHS.has(specifier)) continue

    const key: string = `${file}|${specifier}`
    if (seen.has(key)) continue
    seen.add(key)
    matches.push({ file, specifier })
  }

  matches.sort((a, b) =>
    a.file === b.file
      ? a.specifier.localeCompare(b.specifier)
      : a.file.localeCompare(b.file),
  )
  return matches
}

const expectedShimImports: ReadonlyArray<ShimImport> = []

describe('shim-import ratchet (Tier B sweep complete — no shim imports allowed)', () => {
  it('finds zero imports from webapp/src/shell/edge/main/graph/ shim paths', () => {
    const actual: ReadonlyArray<ShimImport> = findShimImports()
    expect(actual).toEqual(expectedShimImports)
  })
})
