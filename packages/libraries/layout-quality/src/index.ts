// @vt/layout-quality — pure, deterministic layout-quality scorer.
//
// Grades a laid-out graph (node positions/sizes + edges) against seven quality
// pillars and a weighted composite. No DOM, no Cytoscape, no I/O: geometry in,
// scores out. The Electron scorecard harness extracts real geometry from
// `window.cytoscapeInstance` and feeds it to `scoreLayout`; unit tests feed
// hand-built fixtures. Lives in its own package (not webapp) because it is a
// pure verification tool with no webapp runtime consumers.

export * from './layoutQualityScore';
