---
position:
  x: 18976
  y: -2405
isContextNode: false
---
# Change: Add web share — upload markdown vault, get shareable link

## Why
VoiceTree graphs are local-only (Electron). Users want to share a vault as a read-only interactive graph via a URL. No existing sharing/export features exist.

## What Changes
- Add `pure/web-share/` module: domain types, validation, manifest building, graph-from-files construction
- Add Cloudflare Worker (`workers/share-worker/`): R2 upload/serve routes
- Add `shell/web/` I/O edge: r2Client, upload pipeline, view pipeline
- Add web UI: UploadPage (drop zone), ViewerPage (Cytoscape graph), router, Vite web config
- Reuse existing `pure/graph/` (unchanged), Cytoscape styling, React components

## Impact
- Affected specs: none (new capability)
- Affected code:
  - `webapp/src/pure/web-share/` — NEW (4 files: types, validate, manifest, graphFromFiles)
  - `webapp/src/shell/web/` — NEW (r2Client, uploadPipeline, viewPipeline)
  - `webapp/src/shell/web/UI/` — NEW (UploadPage, ViewerPage, NodePanel, useShareView hook)
  - `webapp/src/web-main.tsx` — NEW entry point
  - `webapp/vite.web.config.ts` — NEW web-only Vite config
  - `webapp/workers/share-worker/` — NEW Cloudflare Worker
  - `webapp/src/pure/graph/` — UNCHANGED (reused as-is)
  - `webapp/src/shell/UI/cytoscape-graph-ui/` — REUSED (styling, themes)
