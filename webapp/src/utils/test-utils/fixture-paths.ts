/**
 * Test fixture paths
 *
 * Centralizes fixture path resolution for all tests.
 * Uses import.meta.dirname to resolve paths relative to this file.
 */

import fs from 'node:fs'
import path from 'path'

function findPackageRoot(startDir: string): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('No package.json found walking up from ' + startDir)
}

const PROJECT_ROOT: string = findPackageRoot(import.meta.dirname)

export const FIXTURES_ROOT: string = path.join(PROJECT_ROOT, 'example_folder_fixtures')
export const EXAMPLE_SMALL_PATH: string = path.join(FIXTURES_ROOT, 'example_small')
export const EXAMPLE_LARGE_PATH: string = path.join(FIXTURES_ROOT, 'example_real_large')
