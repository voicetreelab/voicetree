// @vt/daemon-test-harness — shared real-daemon boot harness for black-box e2e.
// Consumed by voicetree-cli's serveOwner e2e (vitest) and webapp's Playwright
// browser round-trip globalSetup. No test-framework coupling at this surface.

export * from './serveHarness.ts'
export * from './browserConfig.ts'
