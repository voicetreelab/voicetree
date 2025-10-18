# Embedding Search Bug Investigation - Handover Document

**Date:** 2025-10-17
**Status:** Root cause identified, solution pending
**Priority:** High (affects semantic search quality)

---

## Executive Summary

The ONNX MiniLM embeddings work correctly in isolation but fail in the full VoiceTree search pipeline. Vector search returns zero results for cross-domain queries (e.g., "baking bread" returns only Programming nodes). The bug is **NOT in the embeddings themselves** but somewhere in our search pipeline logic between the ChromaDB vector store and the final results.

---

## Background: Initial Misleading Investigation

### What We Thought Was Wrong
Integration tests showed vector search returning 0% Cooking nodes for a clear Cooking query:
```
Query: "baking bread flour yeast dough"
Expected: Cooking > Baking nodes
Actual: 0/10 Cooking nodes, 10/10 Programming nodes
```

This led to the **incorrect conclusion** that ONNX MiniLM embeddings had poor semantic quality.

### Why Tests Were Misleading

1. **Test Data Issue**: The integration test (`test_pipeline_e2e_with_real_embeddings.py`) used `ChunkProcessor`, which has a text buffering system that concatenated multiple sentences together into single nodes, contaminating the metadata labels.

2. **Scale Dependency**: With 25 nodes (Programming only), the problem wasn't visible. With 50 nodes (Programming + Cooking), the problem appeared. This suggested a scale-dependent bug in our code, not a fundamental embedding issue.

3. **We Didn't Isolate Early Enough**: We should have tested the embeddings directly first before investigating the full pipeline.

---

## The Proof: Embeddings Actually Work

Created minimal isolation test (`test_vector_embedding_isolation.py`) that bypasses all VoiceTree logic:

```python
# Directly add nodes to ChromaDB
store = ChromaDBVectorStore(...)
store.add_nodes({
    1: "Baking bread requires precise measurements of flour, water, yeast...",
    2: "Gluten development occurs when flour proteins...",
    # ... 5 Cooking nodes
    6: "Python is a high-level programming language...",
    # ... 5 Programming nodes
})

# Direct vector search via ChromaDB
results = store.search("baking bread flour yeast dough", top_k=10)
```

**Result:**
```
✓ All 5 Cooking nodes ranked in top 5 (scores: 0.78, 0.67, 0.63, 0.62, 0.62)
✓ All 5 Programming nodes ranked 6-10 (scores: 0.53, 0.53, 0.49, 0.47, 0.46)
✓ Perfect semantic separation!
```

**Conclusion:** The ONNX MiniLM embeddings are working correctly. The bug is in our search pipeline.

---

## The Bug: Search Pipeline Failure

### Symptoms

When searching through `MarkdownTree` with 50 nodes:
- **BM25 search**: Works perfectly (4/4 Cooking nodes for "baking" query)
- **Vector search**: Returns 0/10 Cooking nodes (all Programming)
- **Hybrid search**: Contaminated but partially saved by BM25

### Code Path Analysis

```
User Query: "baking bread flour yeast dough"
    ↓
MarkdownTree.search_similar_nodes_vector(query, top_k=10)
    ↓
EmbeddingManager.vector_store.search(query, top_k, include_scores=True)
    ↓
ChromaDBVectorStore.search(query, top_k, include_scores=True)
    ↓
[Returns correct results in isolation test]
    ↓
??? Something corrupts results here ???
    ↓
Returns wrong results to diagnostic script
```

### Key Files Involved

1. **`backend/markdown_tree_manager/markdown_tree_ds.py:475-499`**
   - `MarkdownTree.search_similar_nodes_vector()`
   - Calls `self._embedding_manager.vector_store.search()`

2. **`backend/markdown_tree_manager/embeddings/chromadb_vector_store.py:223-285`**
   - `ChromaDBVectorStore.search()`
   - Performs the actual ChromaDB query
   - **Works correctly in isolation**

3. **`backend/markdown_tree_manager/graph_search/tree_functions.py:375-482`**
   - `hybrid_search_for_relevant_nodes()`
   - Lines 443-456: Score threshold filtering
   - **Suspect: `vector_score_threshold=0.5` might be filtering out valid results**

---

## Investigation Hypotheses (Ordered by Likelihood)

### Hypothesis 1: Score Threshold Filtering ⭐ Most Likely
**Location:** `tree_functions.py:443-456`

```python
# Quality filtering: Only keep results above thresholds
vector_filtered = [
    node_id for node_id, score in vector_results_raw
    if score >= vector_score_threshold and node_id not in already_selected
]
```

**Issue:** `vector_score_threshold=0.5` might be too high. In the isolation test, Cooking nodes had scores of 0.62-0.78, but in the full pipeline with 50 nodes, scores might be lower due to:
- Different score normalization with more nodes
- Distance calculation changes with collection size
- ChromaDB's scoring behavior with larger collections

**Test:** Temporarily set `vector_score_threshold=0.0` in diagnostic and see if Cooking nodes appear.

### Hypothesis 2: Similarity Score Calculation
**Location:** `chromadb_vector_store.py:266-269`

```python
# Convert distance to similarity score (1 - normalized_distance)
# ChromaDB returns L2 distance for cosine space, so we convert
similarity = 1.0 - (distance / 2.0)  # Normalize to [0, 1]
```

**Issue:** This conversion might be incorrect. ChromaDB with cosine distance should return values in [0, 2], but the normalization might not be correct for all cases.

**Test:** Log the raw `distance` values from ChromaDB and compare with isolation test.

### Hypothesis 3: Embedding Manager Caching Issue
**Location:** `backend/markdown_tree_manager/embeddings/embedding_manager.py` (not fully reviewed)

**Issue:** The `EmbeddingManager` might be caching or batching embeddings incorrectly, causing stale or wrong vectors to be used.

**Test:** Compare the embedding vectors stored in ChromaDB for the same nodes in both tests (isolation vs full pipeline).

### Hypothesis 4: Asynchronous Embedding Updates
**Location:** `markdown_tree_ds.py:136-160`

```python
def _update_embedding_async(self, node_id: int) -> None:
    """Fire-and-forget embedding update for a single node."""
    future = self._embedding_executor.submit(
        self._embedding_manager.vector_store.add_nodes,
        {node_id: node}
    )
```

**Issue:** The diagnostic script waits 3 seconds for embeddings, but maybe not all embeddings are ready. However, this doesn't explain why it returns Programming nodes instead of no results.

**Test:** Add longer wait time (10+ seconds) and check if behavior changes.

---

## Recommended Investigation Steps

### Step 1: Add Debug Logging (15 minutes)

Modify `chromadb_vector_store.py:search()` to log raw results:

```python
def search(self, query: str, top_k: int = 10, ...):
    # ... existing code ...

    results = self.collection.query(...)

    # ADD DEBUG LOGGING HERE
    logging.info(f"[DEBUG] Raw ChromaDB query results for '{query[:50]}':")
    for i, (id_str, distance) in enumerate(zip(results['ids'][0], results['distances'][0])):
        node_id = int(id_str.replace('node_', ''))
        similarity = 1.0 - (distance / 2.0)
        logging.info(f"  {i+1}. Node {node_id}: distance={distance:.4f}, similarity={similarity:.4f}")

    # ... rest of function ...
```

Run `diagnostic_embedding_quality.py` and compare logs with `test_vector_embedding_isolation.py`.

### Step 2: Test Threshold Theory (5 minutes)

In `diagnostic_embedding_quality.py`, modify the hybrid search call:

```python
# Current
hybrid_results = hybrid_search_for_relevant_nodes(
    decision_tree,
    test_case['query'],
    max_return_nodes=10
)

# Change to
hybrid_results = hybrid_search_for_relevant_nodes(
    decision_tree,
    test_case['query'],
    max_return_nodes=10,
    vector_score_threshold=0.0,  # ADD THIS
    bm25_score_threshold=0.0     # ADD THIS
)
```

If this fixes it, the problem is threshold filtering.

### Step 3: Compare Raw ChromaDB Collections (20 minutes)

```python
# After both tests complete, inspect the collections
from backend.markdown_tree_manager.embeddings.chromadb_vector_store import ChromaDBVectorStore

# Get the collections
isolation_store = ChromaDBVectorStore(collection_name="test_isolation", ...)
pipeline_store = ChromaDBVectorStore(collection_name="voicetree_nodes", ...)

# Compare node 26 (first Cooking node) in both
isolation_node_1 = isolation_store.get_node_by_id(1)  # Baking bread
pipeline_node_26 = pipeline_store.get_node_by_id(26)  # Baking bread

# Check if content matches
print(f"Isolation Node 1: {isolation_node_1}")
print(f"Pipeline Node 26: {pipeline_node_26}")

# Check embeddings by querying with the exact same text
test_query = "Baking bread requires precise measurements of flour, water, yeast, and salt."
iso_results = isolation_store.search(test_query, top_k=5)
pipe_results = pipeline_store.search(test_query, top_k=5)

print(f"Isolation results: {iso_results}")
print(f"Pipeline results: {pipe_results}")
```

### Step 4: Verify Embedding Vector Similarity (30 minutes)

If above steps don't reveal the issue, extract the actual embedding vectors and compare:

```python
# This requires accessing ChromaDB's internal collection
collection = store.collection
results = collection.get(ids=["node_1", "node_26"], include=['embeddings'])
embedding_1 = results['embeddings'][0]
embedding_26 = results['embeddings'][1]

# Calculate cosine similarity manually
from numpy import dot
from numpy.linalg import norm
similarity = dot(embedding_1, embedding_26) / (norm(embedding_1) * norm(embedding_26))
print(f"Manual similarity calculation: {similarity}")
```

---

## Test Files and Scripts

### Working Files
- ✅ `test_vector_embedding_isolation.py` - Proves embeddings work
- ✅ `diagnostic_embedding_quality.py` - Shows the bug in full pipeline

### Test to Fix
- ❌ `backend/tests/integration_tests/text_to_graph_pipeline/chunk_processing_pipeline/test_pipeline_e2e_with_real_embeddings.py`
  - Tests `test_subtopic_relevance_quality` and `test_cross_topic_separation_quality` fail
  - These tests use `CleanMockTreeActionDeciderWorkflow` to avoid chunking
  - After fixing the bug, these should pass

---

## Why I Was Misled by the Tests

### 1. **Didn't Test the Simplest Thing First**
I should have immediately created the isolation test when I saw vector search failing. Instead, I spent time analyzing the embedding model itself and comparing ONNX vs Gemini, when the real issue was our code.

### 2. **Test Complexity Obscured the Bug**
The integration tests had multiple layers:
- `ChunkProcessor` (text buffering)
- `MockTreeActionDeciderWorkflow` (node creation)
- `MarkdownTree` (tree operations)
- `EmbeddingManager` (async updates)
- `ChromaDBVectorStore` (vector search)

This made it impossible to isolate which layer was failing.

### 3. **Assumed Embeddings Were the Problem**
When I saw poor cross-domain results, I immediately blamed the embedding model (ONNX MiniLM) instead of questioning our search pipeline. This is confirmation bias—I expected local embeddings to be worse than Gemini, so I stopped investigating when the tests confirmed that expectation.

### 4. **Didn't Verify Test Data Quality**
The diagnostic script created 25 nodes but only from Programming topic, making it impossible to test cross-domain separation. I should have verified the test data before drawing conclusions.

### 5. **Trusted Integration Tests Too Much**
Integration tests are valuable but can hide bugs in specific components. When a test fails, the first step should be to create a minimal unit test for each component, not to debug the full integration.

---

## Next Steps for Engineer Taking Over

1. **Immediate (< 1 hour):**
   - Run Step 1 and Step 2 from investigation steps above
   - This should identify if threshold filtering is the culprit

2. **Short-term (1-2 hours):**
   - Fix the threshold issue (likely make it configurable or adaptive)
   - Verify fix with both isolation test and diagnostic script
   - Update integration tests to pass

3. **Medium-term (half day):**
   - Add unit tests for each layer: ChromaDBVectorStore, EmbeddingManager, hybrid_search
   - Add debug logging throughout the search pipeline
   - Document the score threshold values and their rationale

4. **Long-term (optional):**
   - Consider whether cosine similarity scores should be normalized differently
   - Investigate if ChromaDB configuration needs tuning for better score consistency
   - Benchmark embedding quality across different collection sizes

---

## Key Learnings for Future Debugging

1. **Always isolate the simplest case first** - Test individual components before debugging integrations
2. **Question your assumptions** - Don't assume the most complex part (embeddings) is wrong
3. **Verify test data quality** - Bad test data leads to wrong conclusions
4. **Add logging early** - Debug logging would have revealed the issue immediately
5. **Trust, but verify** - Integration tests are helpful but can mislead when multiple components are involved

---

## References

- **Working isolation test:** `test_vector_embedding_isolation.py`
- **Diagnostic script:** `diagnostic_embedding_quality.py`
- **Failing integration test:** `backend/tests/integration_tests/text_to_graph_pipeline/chunk_processing_pipeline/test_pipeline_e2e_with_real_embeddings.py`
- **Search pipeline:** `backend/markdown_tree_manager/graph_search/tree_functions.py:375-482`
- **Vector store:** `backend/markdown_tree_manager/embeddings/chromadb_vector_store.py:223-285`
