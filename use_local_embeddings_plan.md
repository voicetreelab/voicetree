# Local Embeddings Implementation Plan for VoiceTree

**Status**: ✅ IMPLEMENTED (Fastembed Default)

---

## Implementation Summary

We implemented a **dramatically simplified** lazy-loading approach:

### What We Built
1. **DefaultEmbeddingFunction** integration in `ChromaDBVectorStore`:
   - Server starts immediately (no blocking)
   - Chroma’s fastembed-backed model auto-downloads on first embedding request
   - Subsequent launches use the cached ONNX model from the user cache directory

2. **Minimal surface area**:
   - No custom download manager, IPC, or React UI
   - Leverages Chroma’s maintained defaults for caching and model updates

3. **Runtime toggle via environment variable**:
   - `VOICETREE_USE_LOCAL_EMBEDDINGS=true` (default) → Fastembed local model
   - `VOICETREE_USE_LOCAL_EMBEDDINGS=false` → Gemini API fallback

### Files Changed
- `backend/markdown_tree_manager/embeddings/chromadb_vector_store.py` – Switched to `DefaultEmbeddingFunction`
- `requirements-server.txt` – Updated to `chromadb[fastembed]>=0.4.24`

### Testing
Run: `python test_local_embeddings.py`

---

## Background Context

### Current State
VoiceTree currently uses **Google Gemini embeddings** (`gemini-embedding-001`) via API calls:
- Location: `backend/markdown_tree_manager/embeddings/chromadb_vector_store.py:115-119`
- Method: ChromaDB with Google Generative AI embedding function
- Requires: API key and internet connection
- Use case: Semantic search for voice mindmapping application

### Problem Statement
Using cloud-based embeddings (Gemini Flash) has limitations:
- Requires internet connectivity
- API costs for high-volume usage
- Privacy concerns (data sent to Google)
- Latency for API calls

### Proposed Solution
Implement **download-on-first-launch** local embedding models:
- Download model (~300-600 MB) on first app launch
- Store in Electron's user data directory
- Use for all subsequent operations offline
- Keep installer size small (~50-100 MB)

---

## Model Selection from MTEB Leaderboard

### Top Candidates (Local & Small Enough)

From MTEB top 10, these are suitable for desktop deployment:

#### 1. **Qwen3-Embedding-0.6B** (Rank #4)
- **Size**: 595M parameters (~1.2 GB, can be quantized)
- **Performance**: Highest performing in reasonable size range
- **Inference Time**: ~20-50ms for 300 words on CPU
- **Best For**: Maximum quality while staying reasonably sized

#### 2. **multilingual-e5-large-instruct** (Rank #7)
- **Size**: 560M parameters (~1.1 GB)
- **Performance**: Well-regarded, proven in production
- **Inference Time**: ~20-50ms for 300 words on CPU
- **Best For**: Safe, solid choice with good community support

#### 3. **embeddinggemma-300m** (Rank #8) ⭐ RECOMMENDED
- **Size**: 307M parameters (~600 MB)
- **Performance**: Designed by Google for on-device applications
- **Inference Time**: ~20-40ms for 300 words on CPU
- **Best For**: Minimizing bundle size while maintaining quality
- **Why**: Specifically optimized for client-side deployment

### Models Too Large
These require 8-15 GB and are impractical for bundling:
- Qwen3-Embedding-8B (7B params)
- Qwen3-Embedding-4B (4B params)
- gte-Qwen2-7B-instruct (7B params)
- Linq-Embed-Mistral (7B params)
- SFR-Embedding-Mistral (7B params)

### API-Only Models
These cannot be downloaded:
- gemini-embedding-001 (current)
- text-multilingual-embedding-002

---

## Architecture Overview

### Download-on-First-Launch Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Installs VoiceTree (~50-100 MB)                     │
│    - Electron app                                            │
│    - PyInstaller Python server                               │
│    - NO embedding model included                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. First Launch                                              │
│    - Electron starts                                         │
│    - Check if model exists in user data directory           │
│    - Model NOT found → Show splash screen                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Model Download (First Launch Only)                       │
│    - Python server starts ChromaDB initialization           │
│    - LocalEmbeddingModel checks for model                   │
│    - Downloads from HuggingFace (~600 MB)                   │
│    - Progress updates sent to Electron UI                   │
│    - Download completes → Model loads into memory           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Subsequent Launches                                       │
│    - Model exists → Load from disk immediately              │
│    - No download, instant startup                            │
│    - Fully offline capable                                   │
└─────────────────────────────────────────────────────────────┘
```

### File Locations

```
VoiceTree App Bundle (~50-100 MB)
├── Electron App
├── PyInstaller Server
└── NO MODEL

User Data Directory (~600 MB after first launch)
├── models/
│   └── embeddinggemma-300m/
│       ├── model.safetensors
│       ├── config.json
│       ├── tokenizer.json
│       └── ...
├── chromadb_data/          # Vector database
└── markdownTreeVault/      # User's mind maps
```

---

## Implementation Plan

### Phase 1: Backend - Model Download Manager

**New File**: `backend/markdown_tree_manager/embeddings/local_model_manager.py`

```python
"""
Manages download and loading of local embedding models.
Downloads model on first launch if not present.
"""
from pathlib import Path
import logging
from typing import Optional, Callable
import os

logger = logging.getLogger(__name__)


class LocalEmbeddingModel:
    """
    Manages local embedding model lifecycle:
    - Download from HuggingFace on first use
    - Load into memory
    - Generate embeddings
    """

    def __init__(
        self,
        model_dir: Optional[str] = None,
        model_name: str = "Alibaba-NLP/gte-Qwen2-7B-instruct",
        progress_callback: Optional[Callable[[str, int], None]] = None
    ):
        """
        Initialize local embedding model.
        Downloads model if not present.

        Args:
            model_dir: Directory to store model (default: app user data)
            model_name: HuggingFace model identifier
            progress_callback: Optional callback(status, percent) for download progress
        """
        # Use Electron's user data directory
        if model_dir is None:
            model_dir = self._get_model_directory()

        self.model_dir = Path(model_dir)
        self.model_name = model_name
        self.model = None
        self.progress_callback = progress_callback

        # Check if model exists, download if needed
        self._ensure_model_available()

    def _get_model_directory(self) -> str:
        """Get platform-appropriate model storage directory."""
        # Priority:
        # 1. Environment variable set by Electron
        # 2. Fall back to home directory
        user_data = os.getenv("VOICETREE_USER_DATA_DIR")
        if user_data:
            return str(Path(user_data) / "models")
        return str(Path.home() / ".voicetree" / "models")

    def _ensure_model_available(self) -> None:
        """Download model if not present, then load it."""
        model_path = self.model_dir / self.model_name.replace("/", "_")

        if not model_path.exists():
            logger.info(f"Model not found at {model_path}. Downloading...")
            if self.progress_callback:
                self.progress_callback("downloading", 0)
            self._download_model()
            if self.progress_callback:
                self.progress_callback("download_complete", 100)
        else:
            logger.info(f"Model found at {model_path}")

        self._load_model()

    def _download_model(self) -> None:
        """Download the embedding model from HuggingFace."""
        try:
            from huggingface_hub import snapshot_download

            logger.info(f"Downloading {self.model_name}...")

            # Download to local directory
            snapshot_download(
                repo_id=self.model_name,
                local_dir=str(self.model_dir / self.model_name.replace("/", "_")),
                allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model"],
                # TODO: Add progress callback hook here if huggingface_hub supports it
            )
            logger.info("Download complete!")

        except Exception as e:
            logger.error(f"Failed to download model: {e}")
            raise RuntimeError(f"Model download failed: {e}")

    def _load_model(self) -> None:
        """Load the model into memory."""
        try:
            from sentence_transformers import SentenceTransformer

            if self.progress_callback:
                self.progress_callback("loading", 90)

            model_path = self.model_dir / self.model_name.replace("/", "_")
            self.model = SentenceTransformer(str(model_path))

            if self.progress_callback:
                self.progress_callback("ready", 100)

            logger.info("Model loaded successfully")

        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            raise RuntimeError(f"Model loading failed: {e}")

    def embed(self, texts: list[str]) -> list:
        """
        Generate embeddings for texts.

        Args:
            texts: List of text strings to embed

        Returns:
            List of embedding vectors (numpy arrays)
        """
        if self.model is None:
            raise RuntimeError("Model not loaded")

        return self.model.encode(texts, show_progress_bar=False)

    def embed_query(self, query: str) -> list:
        """
        Generate embedding for a single query.

        Args:
            query: Query text string

        Returns:
            Embedding vector (numpy array)
        """
        return self.embed([query])[0]
```

### Phase 2: Update ChromaDB Vector Store

**Modify**: `backend/markdown_tree_manager/embeddings/chromadb_vector_store.py`

**Around line 108-120**, replace Gemini initialization:

```python
# Initialize embedding function
self.embedding_function = None
if use_embeddings:
    # Check if we should use local embeddings
    use_local = os.getenv("VOICETREE_USE_LOCAL_EMBEDDINGS", "true").lower() == "true"

    if use_local:
        from backend.markdown_tree_manager.embeddings.local_model_manager import LocalEmbeddingModel

        logger.info("Initializing local embedding model...")

        # This will download on first run
        local_model = LocalEmbeddingModel(
            model_name="google/embeddinggemma-300m"  # or Qwen3-Embedding-0.6B
        )

        # Create ChromaDB-compatible embedding function wrapper
        class LocalEmbeddingFunction:
            def __init__(self, model):
                self.model = model

            def __call__(self, input: list[str]) -> list:
                return self.model.embed(input).tolist()

        self.embedding_function = LocalEmbeddingFunction(local_model)
        logger.info("Initialized ChromaDB with local embeddings")

    else:
        # Fall back to Gemini API
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable not set")

        self.embedding_function = embedding_functions.GoogleGenerativeAiEmbeddingFunction(
            api_key=api_key,
            model_name="models/gemini-embedding-001",
            task_type="SEMANTIC_SIMILARITY"
        )
        logger.info("Initialized ChromaDB with Gemini embeddings")
```

### Phase 3: Electron - Progress UI

**Modify**: `frontend/webapp/electron/main.ts`

**Add model download state tracking** (around line 33):

```typescript
// Model download state
interface ModelDownloadProgress {
  status: 'checking' | 'downloading' | 'loading' | 'ready' | 'error';
  percent: number;
  message?: string;
}

let modelDownloadProgress: ModelDownloadProgress | null = null;

// IPC handler for model download status
ipcMain.handle('get-model-download-status', () => {
  return modelDownloadProgress;
});

// IPC handler to set model download progress (called from Python via HTTP or file)
ipcMain.handle('set-model-download-progress', (event, progress: ModelDownloadProgress) => {
  modelDownloadProgress = progress;
  // Broadcast to all windows
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('model-download-progress', progress);
  });
});
```

**Update startServer function** (around line 113):

```typescript
// Create environment with explicit paths for the server
const serverEnv = {
  ...process.env,
  // Ensure the server knows where to create files
  VOICETREE_DATA_DIR: serverDir,
  VOICETREE_VAULT_DIR: path.join(serverDir, 'markdownTreeVault'),
  // NEW: Set model directory to Electron user data
  VOICETREE_USER_DATA_DIR: app.getPath('userData'),
  VOICETREE_USE_LOCAL_EMBEDDINGS: 'true',  // Enable local embeddings
  // Add minimal PATH if it's missing critical directories
  PATH: process.env.PATH?.includes('/usr/local/bin')
    ? process.env.PATH
    : `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'}`
};
```

### Phase 4: React - Download UI Component

**New File**: `frontend/webapp/src/components/ModelDownloadScreen.tsx`

```tsx
import { useEffect, useState } from 'react';

interface ModelDownloadProgress {
  status: 'checking' | 'downloading' | 'loading' | 'ready' | 'error';
  percent: number;
  message?: string;
}

export function ModelDownloadScreen() {
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);

  useEffect(() => {
    // Listen for download progress from Electron
    const unsubscribe = window.electronAPI?.onModelDownloadProgress?.(
      (progressData: ModelDownloadProgress) => {
        setProgress(progressData);
      }
    );

    // Poll for initial status
    const checkStatus = async () => {
      const status = await window.electronAPI?.getModelDownloadStatus?.();
      if (status) {
        setProgress(status);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 1000);

    return () => {
      clearInterval(interval);
      unsubscribe?.();
    };
  }, []);

  // Don't show if no progress or already ready
  if (!progress || progress.status === 'ready') {
    return null;
  }

  const getStatusMessage = () => {
    switch (progress.status) {
      case 'checking':
        return 'Checking for AI model...';
      case 'downloading':
        return 'Downloading AI model (embeddinggemma-300m, ~600 MB)';
      case 'loading':
        return 'Loading model into memory...';
      case 'error':
        return `Error: ${progress.message || 'Failed to load model'}`;
      default:
        return 'Initializing...';
    }
  };

  const getDetailMessage = () => {
    if (progress.status === 'downloading') {
      return 'This is a one-time process. The model will be stored locally for offline use.';
    }
    if (progress.status === 'error') {
      return 'Please check your internet connection and restart the app.';
    }
    return 'Please wait...';
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg max-w-md shadow-2xl">
        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
          First-Time Setup
        </h2>

        <p className="mb-4 text-gray-700 dark:text-gray-300">
          {getStatusMessage()}
        </p>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {getDetailMessage()}
        </p>

        {progress.status !== 'error' && (
          <>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-2">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-right">
              {progress.percent}% complete
            </p>
          </>
        )}

        {progress.status === 'error' && (
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
```

**Integrate in Main App**: Update `frontend/webapp/src/App.tsx`:

```tsx
import { ModelDownloadScreen } from './components/ModelDownloadScreen';

function App() {
  return (
    <>
      <ModelDownloadScreen />
      {/* Rest of your app */}
    </>
  );
}
```

### Phase 5: Update Dependencies

**Backend** - Add to `requirements-server.txt`:

```
sentence-transformers>=2.2.0
huggingface-hub>=0.19.0
torch>=2.0.0  # Or use CPU-only version to save space
```

**Note**: For smaller bundle size, consider using `torch` CPU-only builds:
```
--extra-index-url https://download.pytorch.org/whl/cpu
torch>=2.0.0+cpu
```

---

## Bundle Size Impact

### Before (Current)
- Electron app: ~50 MB
- PyInstaller server: ~50-100 MB
- **Total installer**: ~100-150 MB

### After (With This Implementation)
- Electron app: ~50 MB
- PyInstaller server: ~100-150 MB (adds sentence-transformers, huggingface-hub)
- **Total installer**: ~150-200 MB

### Runtime (After First Launch)
- User data directory: ~600 MB (embeddinggemma-300m)
- Or ~1.2 GB (Qwen3-Embedding-0.6B)

---

## Inference Performance

For embedding a 300-word text chunk:

| Model | Size | CPU Time | GPU Time | Quality |
|-------|------|----------|----------|---------|
| embeddinggemma-300m | 600 MB | 20-40ms | <10ms | Good |
| Qwen3-Embedding-0.6B | 1.2 GB | 30-60ms | <15ms | Better |
| multilingual-e5-large | 1.1 GB | 30-60ms | <15ms | Better |

**Conclusion**: Even on mid-tier laptops, local embeddings are effectively instantaneous for the user.

---

## Rollout Strategy

### Phase 1: Optional Local Embeddings
- Add environment variable: `VOICETREE_USE_LOCAL_EMBEDDINGS=true`
- Default to Gemini API for stability
- Allow power users to opt-in via config

### Phase 2: Default to Local, Gemini Fallback
- Default: `VOICETREE_USE_LOCAL_EMBEDDINGS=true`
- If download fails → Fall back to Gemini
- Provide UI toggle in settings

### Phase 3: Local Only
- Remove Gemini dependency
- Fully offline capable
- Privacy-first by default

---

## Error Handling

### Download Fails
1. **No Internet**: Show error, prompt retry
2. **Disk Space**: Check available space before download, show warning
3. **HuggingFace Down**: Implement retry with exponential backoff

### Model Loading Fails
1. **Corrupted Download**: Clear cache, re-download
2. **Incompatible Hardware**: Fall back to Gemini API
3. **Out of Memory**: Show error, suggest closing other apps

### Fallback Strategy
```python
try:
    # Try local embeddings
    local_model = LocalEmbeddingModel()
except Exception as e:
    logger.warning(f"Local embeddings failed: {e}")
    logger.info("Falling back to Gemini API")
    # Use Gemini
```

---

## Testing Plan

### Unit Tests
- [ ] Test model download function
- [ ] Test model loading from cache
- [ ] Test embedding generation
- [ ] Test ChromaDB integration with local embeddings

### Integration Tests
- [ ] Test first-launch download flow
- [ ] Test subsequent launches (model cached)
- [ ] Test fallback to Gemini on error
- [ ] Test progress callback mechanism

### Manual Tests
- [ ] Delete model cache, verify download
- [ ] Simulate network failure during download
- [ ] Test on low-spec machine (8GB RAM)
- [ ] Verify offline functionality after first launch

---

## Migration Path for Existing Users

### Scenario: User Already Has ChromaDB with Gemini Embeddings

**Problem**: Switching from Gemini → Local will generate different embeddings.

**Solutions**:

1. **Rebuild Vector Store** (Recommended)
   ```python
   # In MarkdownTree initialization
   if embedding_manager.should_migrate():
       embedding_manager.clear_all_embeddings()
       embedding_manager.sync_all_embeddings()
   ```

2. **Dual Embeddings** (Temporary)
   - Keep both Gemini and local embeddings
   - Phase out Gemini over time
   - Higher storage cost

3. **User Choice**
   - Prompt user on first launch with local embeddings
   - "Rebuild vector database with local model? (Recommended for offline use)"

---

## Next Steps

### Immediate
1. Implement `LocalEmbeddingModel` class
2. Update `ChromaDBVectorStore` to support local embeddings
3. Add environment variable toggle

### Short-term
4. Implement Electron progress tracking
5. Create React download UI component
6. Add fallback logic for errors

### Long-term
7. Optimize model quantization (reduce from 600MB → 300MB)
8. Implement progressive download (download in chunks)
9. Add settings UI for model selection
10. Benchmark performance on various hardware

---

## References

- **MTEB Leaderboard**: https://huggingface.co/spaces/mteb/leaderboard
- **embeddinggemma-300m**: https://huggingface.co/google/embeddinggemma-300m
- **Qwen3-Embedding-0.6B**: https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
- **Sentence Transformers**: https://www.sbert.net/
- **HuggingFace Hub**: https://huggingface.co/docs/huggingface_hub
- **ChromaDB Docs**: https://docs.trychroma.com/

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-10-17 | Use download-on-first-launch | Keeps installer small, provides offline capability |
| 2025-10-17 | Recommend embeddinggemma-300m | Best size/performance tradeoff, designed for on-device |
| 2025-10-17 | Store in Electron user data | Platform-appropriate, user-writable location |
| 2025-10-17 | Use environment variable toggle | Easy rollout, supports gradual migration |

---

## Questions for Team

1. **Model Choice**: embeddinggemma-300m (600MB) or Qwen3-0.6B (1.2GB)?
2. **Default Behavior**: Local first or Gemini first?
3. **Migration**: Force rebuild or dual embeddings?
4. **Quantization**: Pursue 4-bit/8-bit quantization to reduce size?
5. **GPU Support**: Prioritize GPU acceleration or CPU-only?
