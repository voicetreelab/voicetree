/**
 * Test fixture paths
 *
 * Centralizes fixture path resolution for all tests.
 * Uses import.meta.dirname to resolve paths relative to this file.
 */

import path from 'path'

// Resolve project root (this file is in src/utils/test-utils, so go up three levels)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..')

export const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'example_folder_fixtures')
export const EXAMPLE_SMALL_PATH = path.join(FIXTURES_ROOT, 'example_small')
export const EXAMPLE_LARGE_PATH = path.join(FIXTURES_ROOT, 'example_real_large')
