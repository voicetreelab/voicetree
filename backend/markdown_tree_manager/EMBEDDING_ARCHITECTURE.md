# VoiceTree Embedding Architecture

## Recent Changes (2024)

### 1. ChromaDB Integration
- **Added persistent vector storage** using ChromaDB to replace in-memory embeddings
- **Location**: `backend/markdown_tree_manager/embeddings/chromadb_vector_store.py`
- **Features**:
  - Automatic persistence in `chromadb_data/` directory
  - Metadata filtering for advanced queries
  - Hybrid search combining vector + keyword matching

### 2. Batched Embedding Updates
- **Problem**: Creating embeddings on every tree modification was blocking and slow
- **Solution**: Queue updates and process in batches of 10
- **Implementation**:
  - `_pending_embedding_updates` set tracks nodes needing updates
  - Automatic flush when batch size reached
  - Manual flush at workflow completion
  - No async complexity - simple synchronous batching

### 3. Dependency Injection Pattern
- **Test Mode**: Mock embeddings automatically in tests via `VOICETREE_TEST_MODE` env var
- **Injection**: Can pass custom embedding manager to MarkdownTree constructor
- **Result**: Tests run in ~2 seconds instead of minutes (no API calls)

### 4. File Organization
- Moved `vector_search.py` → `backend/markdown_tree_manager/graph_search/`
- Embeddings module in `backend/markdown_tree_manager/embeddings/`
- Better separation of concerns

## Architecture Vision

### Current State
```
Voice Input → Transcription → Chunks → Tree Actions → Markdown Files
                                              ↓
                                    Batched Embeddings → ChromaDB
```

### Immediate Next Steps

1. **Context Retrieval Integration**
   - Wire up `tree.search_similar_nodes()` in the chunking pipeline
   - Replace TF-IDF with hybrid search in `get_most_relevant_nodes()`
   - Use semantic search for finding append targets

2. **Smart Append Logic**
   - Use embeddings to find semantically similar nodes for appending
   - Reduce node fragmentation through better placement decisions

3. **Real-time Optimization**
   - Background process to consolidate similar nodes
   - Use embeddings to identify merge candidates
   - Maintain tree coherence without blocking main pipeline

### Long-term Vision

1. **Multi-modal Embeddings**
   - Include images/diagrams in nodes
   - Embed visual content alongside text
   - Cross-modal search capabilities

2. **Incremental Learning**
   - Fine-tune embeddings based on user corrections
   - Learn domain-specific terminology over time
   - Personalized tree structure preferences

3. **Distributed Processing**
   - Separate embedding service for scalability
   - Queue-based architecture for batch processing
   - Horizontal scaling for large knowledge bases

## Key Design Principles

1. **Non-blocking**: Embeddings never block the main pipeline
2. **Graceful Degradation**: System works without embeddings (fallback to TF-IDF)
3. **Testable**: Mock embeddings in tests for speed
4. **Simple**: No unnecessary async complexity
5. **Persistent**: Embeddings survive restarts via ChromaDB

## Performance Metrics

- **Before**: Tests took minutes due to API calls
- **After**: Tests complete in ~2 seconds with mocks
- **Batch Size**: 10 nodes (configurable)
- **Embedding Model**: Google Gemini text-embedding-004 (768 dimensions)
- **Storage**: ChromaDB with HNSW index for fast similarity search

## Code Locations

- **Tree Data Structure**: `backend/markdown_tree_manager/markdown_tree_ds.py`
- **Embedding Manager**: `backend/markdown_tree_manager/embeddings/embedding_manager.py`
- **ChromaDB Store**: `backend/markdown_tree_manager/embeddings/chromadb_vector_store.py`
- **Vector Search**: `backend/markdown_tree_manager/graph_search/vector_search.py`
- **Workflow Integration**: `backend/text_to_graph_pipeline/chunk_processing_pipeline/tree_action_decider_workflow.py`

## Environment Variables

- `VOICETREE_TEST_MODE`: Set to "true" to use mock embeddings
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`: Required for production embeddings
- `VOICETREE_USE_EMBEDDINGS`: Toggle embeddings on/off (default: true)