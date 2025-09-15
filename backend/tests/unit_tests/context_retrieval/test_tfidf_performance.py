"""
Performance test for TF-IDF implementation
"""
import time
import pytest
from datetime import datetime
from backend.tree_manager.markdown_tree_ds import Node, MarkdownTree
from backend.tree_manager.tree_functions import get_most_relevant_nodes


def test_tfidf_performance():
    """Test that TF-IDF search completes within 50ms for trees with <1000 nodes"""
    # Create a decision tree with many nodes
    tree = MarkdownTree()
    
    # Add 500 nodes with varied content
    for i in range(1, 501):
        node = Node(
            name=f"Node {i} - Topic {i % 20}",
            node_id=i,
            content=f"# Node {i}\nContent for node {i}",
            summary=f"This is a summary for node {i} covering topic {i % 20} with various keywords like algorithm, data, structure, pattern, design, system",
            parent_id=None if i <= 10 else (i - 1) % 10 + 1  # 10 root nodes, rest have parents
        )
        tree.tree[i] = node
    
    # Prepare a complex query
    query = "algorithm design patterns for distributed systems with data structures"
    
    # Warm up (first run might be slower due to imports/initialization)
    _ = get_most_relevant_nodes(tree, limit=50, query=query)
    
    # Measure actual performance
    start_time = time.time()
    relevant_nodes = get_most_relevant_nodes(tree, limit=50, query=query)
    end_time = time.time()
    
    elapsed_ms = (end_time - start_time) * 1000
    
    print(f"TF-IDF search took {elapsed_ms:.2f}ms for {len(tree.tree)} nodes")
    
    # Assert performance requirement
    assert elapsed_ms < 50, f"TF-IDF search took {elapsed_ms:.2f}ms, exceeding 50ms limit"
    
    # Verify we got results
    assert len(relevant_nodes) == 50, "Should return requested number of nodes"


if __name__ == "__main__":
    test_tfidf_performance()