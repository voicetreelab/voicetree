# Simple Local Embeddings Plan (Chroma Fastembed)

## Goal
Enable offline-safe semantic search without custom download logic or heavy ML dependencies by leaning on ChromaDB’s built-in `DefaultEmbeddingFunction`, which wraps FastEmbed + ONNXRuntime and handles model caching automatically.

---

## Why This Works
- **Lazy model download**: Chroma pulls the FastEmbed model (~90 MB) the first time embeddings are requested, storing it under the user’s cache (e.g., `~/.cache/huggingface/fastembed`).
- **Tiny runtime footprint**: The only dependency we need is `chromadb[fastembed]`, which bundles ONNXRuntime (~30 MB) instead of a 2 GB PyTorch stack.
- **Maintained stack**: We rely on Chroma’s official abstraction for updates, bug fixes, and future model improvements.
- **Opt-out**: Setting `VOICETREE_USE_LOCAL_EMBEDDINGS=false` keeps the existing Gemini path intact.

---

## Implementation Snapshot
1. **Dependencies**  
   - Update `requirements-server.txt` to `chromadb[fastembed]>=0.4.24`.

2. **Vector store** (`backend/markdown_tree_manager/embeddings/chromadb_vector_store.py`)  
   - On init, if `VOICETREE_USE_LOCAL_EMBEDDINGS` is truthy, instantiate `embedding_functions.DefaultEmbeddingFunction()`; otherwise fall back to Gemini’s API embedding function.
   - No additional download or caching logic required.

3. **Environment defaults**  
   - Leave `VOICETREE_USE_LOCAL_EMBEDDINGS` unset (defaults to `"true"`).  
   - Document optional overrides:
     ```bash
     VOICETREE_USE_LOCAL_EMBEDDINGS=true   # fastembed (default)
     VOICETREE_USE_LOCAL_EMBEDDINGS=false  # Gemini API
     ```

4. **First-run behavior**  
   - Initial embedding call may take ~15–30 s while FastEmbed downloads the ONNX model. Subsequent requests are instantaneous.
   - Cache location can be redirected with `FASTEMBED_CACHE_PATH` or `HF_HOME` if needed for enterprise deployments.

---

## Testing Checklist
- [ ] Run `python test_local_embeddings.py` (updated to reflect the fastembed path) to verify:
  - Chroma initializes quickly.
  - First embedding triggers the model download.
  - Later queries hit the cached embeddings with low latency.
- [ ] Smoke test the Gemini fallback by setting `VOICETREE_USE_LOCAL_EMBEDDINGS=false`.

---

## Rollout Notes
- No installer bloat: PyInstaller bundles stay small because FastEmbed downloads at runtime.
- Add a release note explaining that first-time searches may take a moment while the embeddings model downloads.
- Optionally expose a settings toggle later for users who prefer the cloud-based route.

