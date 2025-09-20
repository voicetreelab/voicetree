"""
Test TF-IDF implementation for get_most_relevant_nodes function

This test implements the behavioral test from the specification:
Test 1: Technical Concept Disambiguation

Verifies that TF-IDF can distinguish between related technical concepts
and select the most relevant node based on specific terminology.
"""
from backend.markdown_tree_manager.graph_search.tree_functions import (
    get_most_relevant_nodes,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node


class TestTfidfConceptDisambiguation:
    """Test TF-IDF functionality for disambiguating technical concepts"""
    
    def test_technical_concept_disambiguation(self):
        """
        Test 1: Technical Concept Disambiguation
        
        Verifies that TF-IDF correctly identifies the most relevant node when
        searching for specific technical concepts like "convolutional neural networks"
        among related machine learning topics.
        """
        # Create a decision tree
        tree = MarkdownTree()
        
        # Add Node A: Machine Learning Fundamentals
        node_a = Node(
            name="Machine Learning Fundamentals",
            node_id=1,
            content="# Machine Learning Fundamentals\nCore concepts of machine learning",
            summary="Introduction to supervised and unsupervised learning, basic algorithms like linear regression and decision trees",
            parent_id=None
        )
        tree.tree[1] = node_a
        
        # Add Node B: Deep Learning Architectures
        node_b = Node(
            name="Deep Learning Architectures",
            node_id=2,
            content="# Deep Learning Architectures\nAdvanced neural network concepts",
            summary="Neural networks, CNNs, RNNs, transformers, and modern deep learning frameworks",
            parent_id=None
        )
        tree.tree[2] = node_b
        
        # Add Node C: Data Preprocessing
        node_c = Node(
            name="Data Preprocessing",
            node_id=3,
            content="# Data Preprocessing\nPreparing data for ML models",
            summary="Techniques for cleaning, normalizing, and preparing data for machine learning models",
            parent_id=None
        )
        tree.tree[3] = node_c
        
        # Query about convolutional neural networks
        query = "I want to understand how convolutional neural networks process images and extract features for computer vision tasks"
        
        # Get most relevant nodes with full list
        relevant_nodes_all = get_most_relevant_nodes(tree, limit=3, query=query)
        node_ids_all = [node.id for node in relevant_nodes_all]
        
        # All nodes should be included with limit=3
        assert len(relevant_nodes_all) == 3, "Should return all 3 nodes"
        assert 2 in node_ids_all, "Deep Learning node should be included"
        
        # Test with limit=2 to force selection
        relevant_nodes_limited = get_most_relevant_nodes(tree, limit=2, query=query)
        limited_ids = [node.id for node in relevant_nodes_limited]
        
        # Deep Learning should definitely be selected
        assert 2 in limited_ids, "Deep Learning node should be prioritized with limited selection"
        
        # Test with limit=1 to ensure Deep Learning is top choice
        most_relevant = get_most_relevant_nodes(tree, limit=1, query=query)
        
        assert len(most_relevant) == 1, "Should return exactly 1 node"
        assert most_relevant[0].id == 2, (
            f"Deep Learning Architectures (node 2) should be the top choice for CNN query, "
            f"but got node {most_relevant[0].id}: {most_relevant[0].title}. "
            f"TF-IDF should prioritize 'convolutional neural networks' and 'CNNs' terms."
        )
        
    def test_disambiguation_with_varying_specificity(self):
        """
        Additional test to verify TF-IDF handles queries with different levels of specificity
        """
        tree = MarkdownTree()
        
        # Same nodes as above
        tree.tree[1] = Node(
            name="Machine Learning Fundamentals",
            node_id=1,
            content="# Machine Learning Fundamentals",
            summary="Introduction to supervised and unsupervised learning, basic algorithms like linear regression and decision trees",
            parent_id=None
        )
        
        tree.tree[2] = Node(
            name="Deep Learning Architectures",
            node_id=2,
            content="# Deep Learning Architectures",
            summary="Neural networks, CNNs, RNNs, transformers, and modern deep learning frameworks",
            parent_id=None
        )
        
        tree.tree[3] = Node(
            name="Data Preprocessing",
            node_id=3,
            content="# Data Preprocessing",
            summary="Techniques for cleaning, normalizing, and preparing data for machine learning models",
            parent_id=None
        )
        
        # Test with a more general query
        general_query = "machine learning algorithms"
        result_general = get_most_relevant_nodes(tree, limit=1, query=general_query)
        
        # Should select Machine Learning Fundamentals for general query
        assert result_general[0].id == 1, (
            "Machine Learning Fundamentals should be selected for general ML query"
        )
        
        # Test with preprocessing-specific query
        preprocessing_query = "data normalization and cleaning techniques"
        result_preprocess = get_most_relevant_nodes(tree, limit=1, query=preprocessing_query)
        
        # Should select Data Preprocessing
        assert result_preprocess[0].id == 3, (
            "Data Preprocessing should be selected for data preparation query"
        )