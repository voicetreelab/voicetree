import { describe, it, expect } from 'vitest'
import chokidar from 'chokidar'

// Regression guard: if rollup ever strips fsevents/chokidar from the main-process bundle
// this test will fail at import time (Module not found) rather than silently at runtime.
// See [L4-BF-187]: externalNativePlugin in electron.vite.config.ts is what keeps this green.
describe('chokidar native deps', () => {
  it('chokidar.watch() constructs and closes without throwing', async () => {
    const watcher: chokidar.FSWatcher = chokidar.watch('.', { ignoreInitial: true })
    expect(watcher).toBeDefined()
    await watcher.close()
  })
})
