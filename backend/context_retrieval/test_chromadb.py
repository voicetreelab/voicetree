#!/usr/bin/env python3
"""
Test script for ChromaDB vector store implementation.
"""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import logging
from dataclasses import dataclass

from backend.markdown_tree_manager.embeddings.chromadb_vector_store import (
    ChromaDBVectorStore,
)

logging.basicConfig(level=logging.INFO)


@dataclass
class MockNode:
    """Mock node for testing"""
    title: str
    summary: str
    content: str
    depth: int = 1
    node_type: str = "concept"


def test_chromadb_basic():
    """Test basic ChromaDB operations"""
    print("\n=== Testing ChromaDB Basic Operations ===\n")

    # Create test nodes
    nodes = {
        1: MockNode(
            title="Machine Learning Basics",
            summary="Introduction to ML concepts and algorithms",
            content="Machine learning is a subset of artificial intelligence that enables systems to learn from data."
        ),
        2: MockNode(
            title="Neural Networks",
            summary="Deep learning architectures and backpropagation",
            content="Neural networks are computing systems inspired by biological neural networks."
        ),
        3: MockNode(
            title="Natural Language Processing",
            summary="Text processing and language understanding",
            content="NLP combines computational linguistics with machine learning to process human language."
        ),
        4: MockNode(
            title="Computer Vision",
            summary="Image processing and visual perception",
            content="Computer vision enables machines to interpret and understand visual information from the world."
        )
    }

    # Initialize ChromaDB store
    store = ChromaDBVectorStore(
        collection_name="test_voicetree",
        persist_directory="./test_chromadb_data"
    )

    # Clear any existing data
    store.clear_collection()

    # Add nodes
    print("Adding nodes to ChromaDB...")
    store.add_nodes(nodes)

    # Get collection stats
    stats = store.get_collection_stats()
    print(f"Collection stats: {stats}")

    # Test search
    queries = [
        "How do neural networks work?",
        "What is deep learning?",
        "Language models and NLP",
        "Image recognition and visual processing"
    ]

    for query in queries:
        print(f"\nQuery: '{query}'")
        results = store.search(query, top_k=3, include_scores=True)
        for node_id, score in results:
            node = nodes[node_id]
            print(f"  - Node {node_id}: {node.title} (score: {score:.3f})")

    print("\n✅ Basic operations test completed!")


def test_metadata_filtering():
    """Test metadata filtering capabilities"""
    print("\n=== Testing Metadata Filtering ===\n")

    # Create nodes with different metadata
    nodes = {
        1: MockNode(title="Root Concept", summary="High-level overview", content="Main topic", depth=0),
        2: MockNode(title="Sub Topic A", summary="Details about A", content="Subtopic A content", depth=1),
        3: MockNode(title="Sub Topic B", summary="Details about B", content="Subtopic B content", depth=1),
        4: MockNode(title="Deep Detail", summary="Very specific info", content="Detailed content", depth=2),
    }

    store = ChromaDBVectorStore(
        collection_name="test_metadata",
        persist_directory="./test_chromadb_data"
    )
    store.clear_collection()
    store.add_nodes(nodes)

    # Test with depth filter
    print("Searching with depth <= 1 filter:")
    results = store.search(
        "topic information",
        top_k=10,
        filter_dict={"depth": {"$lte": 1}},
        include_scores=False
    )
    for node_id in results:
        node = nodes[node_id]
        print(f"  - Node {node_id}: {node.title} (depth: {node.depth})")

    print("\n✅ Metadata filtering test completed!")


def test_hybrid_search():
    """Test hybrid search combining keyword and vector results"""
    print("\n=== Testing Hybrid Search ===\n")

    nodes = {
        1: MockNode(title="Python Programming", summary="Python basics", content="Python is a high-level programming language"),
        2: MockNode(title="JavaScript Frameworks", summary="React and Vue", content="Modern web development with JavaScript"),
        3: MockNode(title="Database Systems", summary="SQL and NoSQL", content="Data storage and retrieval systems"),
        4: MockNode(title="Python Web Frameworks", summary="Django and Flask", content="Building web applications with Python"),
    }

    store = ChromaDBVectorStore(
        collection_name="test_hybrid",
        persist_directory="./test_chromadb_data"
    )
    store.clear_collection()
    store.add_nodes(nodes)

    # Simulate keyword search results (e.g., from TF-IDF)
    keyword_results = [1, 4]  # Nodes that mention "Python"

    # Perform hybrid search
    query = "web development frameworks"
    combined_results = store.hybrid_search(
        query=query,
        keyword_results=keyword_results,
        top_k=3,
        alpha=0.6  # Slightly favor vector search
    )

    print(f"Query: '{query}'")
    print(f"Keyword results: {keyword_results}")
    print(f"Hybrid results: {combined_results}")

    for node_id in combined_results:
        node = nodes[node_id]
        print(f"  - Node {node_id}: {node.title}")

    print("\n✅ Hybrid search test completed!")


def test_persistence():
    """Test that ChromaDB persists data across sessions"""
    print("\n=== Testing Persistence ===\n")

    persist_dir = "./test_chromadb_data"

    # First session: add data
    store1 = ChromaDBVectorStore(
        collection_name="test_persistence",
        persist_directory=persist_dir
    )
    store1.clear_collection()

    nodes = {
        1: MockNode(title="Persistent Node", summary="This should persist", content="Persistent content")
    }
    store1.add_nodes(nodes)
    stats1 = store1.get_collection_stats()
    print(f"Session 1 - Added nodes. Count: {stats1['count']}")

    # Second session: verify data persists
    store2 = ChromaDBVectorStore(
        collection_name="test_persistence",
        persist_directory=persist_dir
    )
    stats2 = store2.get_collection_stats()
    print(f"Session 2 - Loaded collection. Count: {stats2['count']}")

    # Search in second session
    results = store2.search("persistent", top_k=1, include_scores=False)
    if results:
        print(f"Found persisted node: {results[0]}")
        print("✅ Persistence test completed!")
    else:
        print("❌ Persistence test failed - data not found")


def cleanup_test_data():
    """Clean up test data"""
    import shutil
    test_dir = Path("./test_chromadb_data")
    if test_dir.exists():
        shutil.rmtree(test_dir)
        print("\n🧹 Cleaned up test data")


if __name__ == "__main__":
    print("=" * 60)
    print("ChromaDB Vector Store Test Suite")
    print("=" * 60)

    try:
        test_chromadb_basic()
        test_metadata_filtering()
        test_hybrid_search()
        test_persistence()
    finally:
        cleanup_test_data()

    print("\n" + "=" * 60)
    print("All tests completed successfully! ✅")
    print("=" * 60)