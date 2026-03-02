---
position:
  x: 16539
  y: -5330
isContextNode: false
---
## Context
VoiceTree is an Electron app for visualizing markdown file trees as interactive graphs. The web share feature allows users to upload a vault folder and receive a shareable URL where others can view the graph read-only in a browser. Architecture follows the existing pure/shell separation: pure core is identical between Electron and web, only the I/O edge differs.

## Goals / Non-Goals
- Goals:
  - Upload folder of .md files → get shareable URL
  - View shared graph with full Cytoscape visualization (read-only)
  - Reuse existing pure/graph/ modules unchanged
  - Each component independently testable with real integration tests (no mocks)
- Non-Goals:
  - Authentication / private shares (public links only for MVP)
  - Editing shared graphs
  - Voice input on web
  - Terminal/agent spawning on web

## Decisions
- **Storage: Cloudflare R2** — 10GB free, zero egress, no inactivity pause. Raw .md files stored as-is (not JSON bundle). Markdown is source of truth at rest and in transit.
- **API: Cloudflare Worker** — Minimal routes (POST upload, GET serve). ~30 lines of route logic.
- **Frontend: Static React** — Deployed to Cloudflare Pages. Separate Vite config from Electron build.
- **Same pipeline, different I/O edge** — Electron: fs.readFile → parse → buildGraph. Web: fetch(R2) → parse → buildGraph. Pure core is identical.
- **No database for MVP** — Metadata in manifest.json inside R2.
- **Boundary structure: Option A (monorepo with lint-enforced boundaries)** — Fast MVP, migrate to extracted packages when second consumer appears.

## Risks / Trade-offs
- Public links with no auth → abuse potential. Mitigated by file count/size limits and rate limiting at Worker level.
- Unbounded parallel fetch on view → load spikes. Accepted for MVP (browser-native concurrency, no manual batching).
- Path identity mismatch (relative vs absolute) → position hydration failure. Mitigated by RelativePath normalization invariant in pure core.
- ValidateFiles type contract mismatch (File[] vs string[]) → Resolved by using RelativePath[] in pure core, File[] only at browser I/O edge.

## Implementation Notes (post-build)
- `applyGraphDeltaToWebUI.ts` (~194 lines) extracts core Cytoscape CRUD operations without Electron dependencies, enabling the web viewer to apply graph deltas independently of the Electron shell.
- `NodePanel` and `useShareView` hook from the original design were simplified away — ViewerPage handles graph display directly.
- `mergePositionsIntoGraph` was relocated from shell/ to `pure/graph/positioning/` to be reusable across both Electron and web shells.

## Migration Plan
No migration needed — entirely new feature with no existing data to migrate.

## Resolved Decisions
- **Max upload size: 20MB total** (per user decision)
- **Max file size: 1MB per file** (defense-in-depth)
- **Max file count: 1000 files**
- **Browser-native fetch concurrency** (no manual batching — simplified from original 6-connection cap plan)
- **Share link expiry: never** (simplest for MVP)
- **Node dragging: read-only** (no drag for MVP)
- **Local dev: miniflare + vite dev server** (no Cloudflare account needed until deploy)
