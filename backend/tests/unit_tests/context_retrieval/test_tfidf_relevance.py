"""
Test TF-IDF implementation for get_most_relevant_nodes function

This test implements the behavioral test from the specification:
Test 3: Handling Domain-Specific Terminology
"""
from backend.markdown_tree_manager.graph_search.tree_functions import (
    get_most_relevant_nodes,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node


class TestTfidfRelevance:
    """Test TF-IDF functionality in get_most_relevant_nodes"""
    
    def test_domain_specific_terminology(self):
        """
        Test 3: Handling Domain-Specific Terminology
        
        Verifies that TF-IDF correctly prioritizes nodes with highly distinctive 
        domain-specific terms like "Dijkstra's algorithm"
        """
        # Create a decision tree
        tree = MarkdownTree()
        
        # Add Node A: Introduction to Algorithms
        node_a = Node(
            name="Introduction to Algorithms",
            node_id=1,
            content="# Introduction to Algorithms\nBasic concepts of algorithm analysis",
            summary="Big O notation, time complexity, space complexity, algorithm analysis",
            parent_id=None
        )
        tree.tree[1] = node_a
        
        # Add Node B: Sorting and Searching
        node_b = Node(
            name="Sorting and Searching",
            node_id=2,
            content="# Sorting and Searching\nVarious sorting and searching techniques",
            summary="Quicksort, mergesort, binary search, hash tables, comparison of sorting algorithms",
            parent_id=None
        )
        tree.tree[2] = node_b
        
        # Add Node C: Graph Algorithms
        node_c = Node(
            name="Graph Algorithms",
            node_id=3,
            content="# Graph Algorithms\nGraph traversal and path algorithms",
            summary="DFS, BFS, Dijkstra's algorithm, minimum spanning trees, topological sort",
            parent_id=None
        )
        tree.tree[3] = node_c
        
        # Query about Dijkstra's algorithm
        query = "I'm implementing Dijkstra's shortest path algorithm for a routing system and need to understand priority queues and graph traversal"
        
        # Get most relevant nodes (limit to 3 to force selection)
        relevant_nodes = get_most_relevant_nodes(tree, limit=3, query=query)
        
        # Extract node IDs for easier comparison
        node_ids = [node.id for node in relevant_nodes]
        
        # Node C (Graph Algorithms) should be included since it mentions Dijkstra's
        assert 3 in node_ids, "Node C (Graph Algorithms) should be selected for Dijkstra query"
        
        # Since we have a limit of 3 and all nodes are roots, all should be included
        # but we specifically verify that Node C is among them
        assert len(relevant_nodes) == 3, "Should return exactly 3 nodes"
        
        # To verify proper TF-IDF prioritization, let's test with a smaller limit
        # that forces actual selection based on relevance
        relevant_nodes_limited = get_most_relevant_nodes(tree, limit=2, query=query)
        limited_ids = [node.id for node in relevant_nodes_limited]
        
        # With only 2 slots and a Dijkstra-specific query, Node C should definitely be selected
        assert 3 in limited_ids, "Node C should be prioritized when limit forces selection"
        
        # Test with an even more restrictive limit to ensure Graph Algorithms is top choice
        most_relevant = get_most_relevant_nodes(tree, limit=1, query=query)
        
        # With only 1 slot, it should pick the most relevant node
        # Since all are root nodes, it should pick based on TF-IDF relevance
        assert len(most_relevant) == 1, "Should return exactly 1 node"
        
        # The single selected node should be the Graph Algorithms node
        # because "Dijkstra's" is a highly distinctive term
        assert most_relevant[0].id == 3, "Graph Algorithms node should be the top choice for Dijkstra query"