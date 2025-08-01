"""
Edge case tests for TF-IDF implementation
"""
import pytest
from datetime import datetime
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node, DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_functions import get_most_relevant_nodes


class TestTfidfEdgeCases:
    """Test edge cases for TF-IDF functionality"""
    
    def test_empty_query_returns_recent_nodes_only(self):
        """Test that empty query returns recent nodes only (branching factor fallback removed)"""
        tree = DecisionTree()
        
        # Add some nodes
        for i in range(1, 6):
            node = Node(
                name=f"Node {i}",
                node_id=i,
                content=f"Content {i}",
                summary=f"Summary {i}",
                parent_id=None
            )
            tree.tree[i] = node
        
        # Empty query returns only recent nodes (up to 3/8 of limit)
        # With limit=3: (3*3)//8 = 1 recent node
        results = get_most_relevant_nodes(tree, limit=3, query="")
        assert len(results) == 1  # Only recent nodes selected, no branching factor fallback
        
        # None query should behave the same
        results = get_most_relevant_nodes(tree, limit=3, query=None)
        assert len(results) == 1
    
    def test_query_with_only_stopwords(self):
        """Test that query with only stopwords still works"""
        tree = DecisionTree()
        
        # Add nodes
        node1 = Node(
            name="Programming Languages",
            node_id=1,
            content="Content about programming",
            summary="Discussion of various programming languages and their features",
            parent_id=None
        )
        tree.tree[1] = node1
        
        node2 = Node(
            name="Data Structures",
            node_id=2,
            content="Content about data",
            summary="Arrays, lists, trees, and graphs",
            parent_id=None
        )
        tree.tree[2] = node2
        
        # Query with mostly stopwords
        results = get_most_relevant_nodes(tree, limit=2, query="the and of in with")
        
        # Should still return nodes (all nodes since limit allows)
        assert len(results) == 2
    
    def test_special_characters_in_query(self):
        """Test that special characters in query are handled properly"""
        tree = DecisionTree()
        
        # Add nodes
        node1 = Node(
            name="C++ Programming",
            node_id=1,
            content="Content",
            summary="Object-oriented programming with C++",
            parent_id=None
        )
        tree.tree[1] = node1
        
        node2 = Node(
            name="Python Programming",
            node_id=2,
            content="Content",
            summary="High-level programming with Python",
            parent_id=None
        )
        tree.tree[2] = node2
        
        # Query with special characters
        results = get_most_relevant_nodes(tree, limit=1, query="C++ object-oriented")
        
        # Should handle special characters gracefully
        assert len(results) == 1
        assert results[0].id == 1  # C++ node should be selected
    
    def test_very_long_query(self):
        """Test that very long queries are handled efficiently"""
        tree = DecisionTree()
        
        # Add nodes
        for i in range(1, 11):
            node = Node(
                name=f"Technical Topic {i}",
                node_id=i,
                content=f"Content {i}",
                summary=f"This covers technical topic {i} with various subtopics",
                parent_id=None
            )
            tree.tree[i] = node
        
        # Very long query
        long_query = " ".join([f"technical topic {i} subtopic analysis" for i in range(50)])
        
        # Should handle long query without error
        results = get_most_relevant_nodes(tree, limit=5, query=long_query)
        assert len(results) == 5
    
    def test_unicode_characters(self):
        """Test that unicode characters are handled properly"""
        tree = DecisionTree()
        
        # Add nodes with unicode
        node1 = Node(
            name="Café Management",
            node_id=1,
            content="Content",
            summary="Managing a café business with special menu items",
            parent_id=None
        )
        tree.tree[1] = node1
        
        node2 = Node(
            name="Naïve Algorithms",
            node_id=2,
            content="Content",
            summary="Simple algorithmic approaches and naïve solutions",
            parent_id=None
        )
        tree.tree[2] = node2
        
        # Query with unicode
        results = get_most_relevant_nodes(tree, limit=1, query="café menu")
        assert len(results) == 1
        
        # Another unicode query
        results = get_most_relevant_nodes(tree, limit=1, query="naïve approach")
        assert len(results) == 1