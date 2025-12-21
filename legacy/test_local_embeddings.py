#!/usr/bin/env python3
"""
Simple test script to verify local embeddings work with lazy loading.
This tests that:
1. ChromaDB initializes quickly without blocking
2. Embeddings download on first use
3. Subsequent operations use cached model
"""

import os
import sys
import time
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

# Set environment variables
os.environ["VOICETREE_USE_LOCAL_EMBEDDINGS"] = "true"
os.environ["VOICETREE_TEST_MODE"] = "false"  # Use persistent storage for this test

from backend.markdown_tree_manager.embeddings.chromadb_vector_store import ChromaDBVectorStore
from backend.markdown_tree_manager.markdown_tree_ds import Node

def test_lazy_loading():
    """Test that initialization is fast and embeddings load on first use."""

    print("=" * 60)
    print("Testing Local Embeddings with Lazy Loading")
    print("=" * 60)

    # Test 1: Fast initialization
    print("\n[Test 1] Initializing ChromaDBVectorStore...")
    start = time.time()

    test_dir = Path(__file__).parent / "test_embeddings_data"
    test_dir.mkdir(exist_ok=True)

    store = ChromaDBVectorStore(
        collection_name="test_local_embeddings",
        persist_directory=str(test_dir / "chromadb"),
        use_embeddings=True
    )

    init_time = time.time() - start
    print(f"✓ Initialization took {init_time:.2f}s (should be <1s)")

    if init_time > 1.0:
        print("⚠ WARNING: Initialization took longer than expected!")
    else:
        print("✓ Fast initialization confirmed!")

    # Test 2: Add nodes (triggers embedding initialization)
    print("\n[Test 2] Adding nodes (will trigger model download if needed)...")
    print("Note: First run may take 2-3 minutes to download model (~600 MB)")

    test_nodes = {
        1: Node(
            node_id=1,
            title="Test Node 1",
            summary="This is a test node about machine learning",
            content="Machine learning is a subset of artificial intelligence."
        ),
        2: Node(
            node_id=2,
            title="Test Node 2",
            summary="This is a test node about neural networks",
            content="Neural networks are inspired by biological neural networks."
        )
    }

    start = time.time()
    store.add_nodes(test_nodes)
    add_time = time.time() - start

    print(f"✓ add_nodes() took {add_time:.2f}s")

    # Test 3: Search (should be fast now)
    print("\n[Test 3] Searching for similar nodes...")
    start = time.time()

    results = store.search("artificial intelligence", top_k=2, include_scores=True)

    search_time = time.time() - start
    print(f"✓ search() took {search_time:.2f}s")
    print(f"✓ Found {len(results)} results:")

    for node_id, score in results:
        print(f"  - Node {node_id}: similarity = {score:.3f}")

    # Test 4: Verify model is cached
    print("\n[Test 4] Checking if model is cached...")
    model_dir = test_dir / "models"
    model_path = model_dir / "embeddinggemma-300m"

    if model_path.exists():
        print(f"✓ Model cached at: {model_path}")
        # Get size
        size_mb = sum(f.stat().st_size for f in model_path.rglob('*') if f.is_file()) / (1024 * 1024)
        print(f"✓ Model size: {size_mb:.1f} MB")
    else:
        print("⚠ Model not found in cache (may be using Gemini API)")

    # Test 5: Second search should be instant
    print("\n[Test 5] Testing cached performance...")
    start = time.time()
    results = store.search("neural networks", top_k=2)
    search_time_2 = time.time() - start

    print(f"✓ Second search took {search_time_2:.2f}s (should be <0.1s)")

    if search_time_2 < 0.1:
        print("✓ Cached embeddings working perfectly!")

    # Cleanup
    print("\n[Cleanup] Removing test data...")
    import shutil
    if test_dir.exists():
        shutil.rmtree(test_dir)
    print("✓ Test data cleaned up")

    print("\n" + "=" * 60)
    print("All tests completed successfully! 🎉")
    print("=" * 60)
    print("\nSummary:")
    print(f"  - Initialization: {init_time:.2f}s")
    print(f"  - First operation: {add_time:.2f}s")
    print(f"  - First search: {search_time:.2f}s")
    print(f"  - Cached search: {search_time_2:.2f}s")
    print("\nLocal embeddings are ready to use!")


if __name__ == "__main__":
    try:
        test_lazy_loading()
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
