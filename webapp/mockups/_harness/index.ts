// Public entry point for the browser-only mockup harness.
//
// New mockups should import everything they need from here.

export { mountMockupHarness } from './mountHarness'
export type { MountHarnessOptions, HarnessHandle, HarnessLegendItem } from './mountHarness'
export { buildSampleGraph } from './sampleGraph'
export type { SampleGraphOptions } from './sampleGraph'
export { setupNodeEditors, closeAllNodeEditors } from './nodeEditors'
export { getHarnessViteAliases } from './viteAliases'
export type { ViteAliasEntry } from './viteAliases'
