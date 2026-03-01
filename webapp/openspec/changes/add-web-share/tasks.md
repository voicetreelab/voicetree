## 1. Pure Core Types & Functions (Phase 1) ✅
- [x] 1.1 Create `pure/web-share/types.ts` — plain type aliases (ShareId, RelativePath, ShareManifest, UploadError, ViewError), constants
- [x] 1.2 Create `pure/web-share/validateUpload.ts` — Map<RelativePath, string> → Either<UploadError, RelativePath[]>, path normalization inlined
- [x] 1.3 Create `pure/web-share/buildManifest.ts` — (paths, folderName) → ShareManifest (no nodeCount)
- [x] 1.4 Create `pure/web-share/buildGraphFromFiles.ts` — Map<RelativePath, string> → Graph
- [x] 1.5 Write pure unit tests (data in/out, no I/O) — 16 tests in `__tests__/web-share.test.ts`

## 2. Cloudflare Worker (Phase 2 — parallel with Phase 1) ✅
- [x] 2.1 Create `workers/share-worker/wrangler.toml` — R2 bucket binding
- [x] 2.2 Create `workers/share-worker/src/index.ts` — POST /upload, GET /share/{id}/**
- [x] 2.3 Add edge safeguards — file count/size limits, CORS
- [x] 2.4 Write worker E2E tests with miniflare (real HTTP, test bucket) — 10 tests in `test/worker.test.ts`

## 3. I/O Edge, Pipelines & Web Rendering (Phase 3 — depends on Phase 1 + 2) ✅
- [x] 3.0 Relocate `mergePositionsIntoGraph` from shell/ to `pure/graph/positioning/mergePositionsIntoGraph.ts`
- [x] 3.1 Create `shell/web/r2Client.ts` — fetch functions with baseUrl param (no DI interface)
- [x] 3.2 Create `shell/web/uploadPipeline.ts` — compose validate → manifest → upload
- [x] 3.3 Create `shell/web/viewPipeline.ts` — compose fetch → buildGraph → mergePositions → delta
- [x] 3.4 Create `shell/web/applyGraphDeltaToWebUI.ts` — ~194-line Cytoscape CRUD extractor without Electron dependencies
- [ ] 3.5 Write integration tests against miniflare — NOT BUILT (deferred)

## 4. Web UI + E2E (Phase 4 — depends on Phase 3) ✅ (partial)
- [x] 4.1 Create `vite.web.config.ts` + `web-index.html`
- [x] 4.2 Create `web-main.tsx` — entry point with react-router-dom
- [x] 4.3 Create `shell/web/UI/pages/UploadPage.tsx` — drop zone, progress, share link
- [x] 4.4 Create `shell/web/UI/pages/ViewerPage.tsx` — Cytoscape viewer reusing applyGraphDeltaToWebUI (read-only)
- ~~4.5 Create `shell/web/UI/components/NodePanel.tsx`~~ — Not built (simplified: ViewerPage handles display directly)
- [x] 4.6 Test fixture vault at `public/example_small/` (larger than originally planned 3-node structure)
- [ ] 4.7 Write Playwright browser E2E: upload → get link → view → verify graph — NOT BUILT (deferred to Phase 5B)
