// Public entry point for the browser-only mockup harness.
//
// The harness now drives the REAL VoiceTree folder-node pipeline end-to-end
// (real folderCollapse → real applyGraphDeltaToUI → real graph-state
// `project()`). See ./README.md for the dependency layering.

export { mountMockupHarness } from './mountHarness'
export type { MountHarnessOptions, HarnessHandle, HarnessLegendItem } from './mountHarness'
export { getHarnessViteAliases } from './viteAliases'
export type { ViteAliasEntry } from './viteAliases'
export { buildPlaygroundFixture } from './playground/domainFixture'
export type { PlaygroundFixture } from './playground/domainFixture'
export { createInBrowserDaemon } from './playground/inBrowserDaemon'
export type { InBrowserDaemon, FolderState, DaemonState } from './playground/inBrowserDaemon'
