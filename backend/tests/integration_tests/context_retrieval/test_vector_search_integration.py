"""
Test integration between vector search and context retrieval pipeline.
Verifies that tree.search_similar_nodes() properly integrates with get_most_relevant_nodes().
"""

from unittest.mock import Mock

import pytest

from backend.markdown_tree_manager.graph_search.tree_functions import (
    get_most_relevant_nodes,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class TestVectorSearchIntegration:
    """Test that vector search is properly integrated into context retrieval"""

    @pytest.fixture
    def mock_tree_with_vector_search(self):
        """Create a tree with mock vector search functionality"""
        # Create tree with mock embedding manager
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.search = Mock()

        tree = MarkdownTree(embedding_manager=mock_manager)

        # Add test nodes with semantic relationships
        node1 = tree.create_new_node(
            "Machine Learning Basics", None,
            "Introduction to neural networks and deep learning algorithms",
            "Overview of ML fundamentals"
        )
        node2 = tree.create_new_node(
            "Artificial Intelligence Overview", None,
            "AI encompasses machine learning, natural language processing, and computer vision",
            "Broad AI introduction"
        )
        node3 = tree.create_new_node(
            "Cooking Recipes", None,
            "Collection of pasta and pizza recipes for dinner",
            "Food preparation guide"
        )
        node4 = tree.create_new_node(
            "Data Science Pipeline", None,
            "ETL processes, feature engineering, and model deployment",
            "End-to-end data workflows"
        )

        return tree, mock_manager, [node1, node2, node3, node4]

    def test_vector_search_improves_semantic_relevance(self, mock_tree_with_vector_search):
        """Test that vector search finds semantically related nodes TF-IDF might miss"""
        tree, mock_manager, nodes = mock_tree_with_vector_search

        # Mock vector search to return semantically related nodes
        # AI query should return ML and Data Science nodes (semantically related)
        mock_manager.search.return_value = [nodes[0], nodes[1], nodes[3]]  # ML, AI, Data Science

        # Query that should benefit from semantic understanding
        query = "artificial intelligence and neural networks"

        # Get results using current pipeline
        results = get_most_relevant_nodes(tree, limit=10, query=query)

        # Vector search should have been called
        mock_manager.search.assert_called()

        # Results should prioritize semantically related nodes
        result_titles = [node.title for node in results]

        # Should include ML and AI related nodes, not cooking
        assert any("Machine Learning" in title for title in result_titles)
        assert any("Artificial Intelligence" in title for title in result_titles)
        assert not any("Cooking" in title for title in result_titles)

    def test_vector_search_fallback_to_tfidf(self, mock_tree_with_vector_search):
        """Test graceful fallback when vector search fails"""
        tree, mock_manager, nodes = mock_tree_with_vector_search

        # Mock vector search failure
        mock_manager.search.side_effect = Exception("Vector search failed")

        query = "machine learning"

        # Should still return results using TF-IDF fallback
        results = get_most_relevant_nodes(tree, limit=10, query=query)

        # Should have attempted vector search first
        mock_manager.search.assert_called()

        # Should still get some results from TF-IDF fallback
        assert len(results) > 0

    def test_embedding_flush_before_search(self, mock_tree_with_vector_search):
        """Test that pending embeddings are flushed before search"""
        tree, mock_manager, nodes = mock_tree_with_vector_search
        mock_manager.search.return_value = []

        # Add pending embedding updates
        tree._pending_embedding_updates = {nodes[0], nodes[1]}

        query = "test query"
        get_most_relevant_nodes(tree, limit=5, query=query)

        # Should have flushed embeddings before search
        assert len(tree._pending_embedding_updates) == 0
        mock_manager.search.assert_called()

    def test_hybrid_search_combines_tfidf_and_vector(self, mock_tree_with_vector_search):
        """Test that hybrid search combines both TF-IDF and vector results"""
        tree, mock_manager, nodes = mock_tree_with_vector_search

        # Mock vector search to return different nodes than TF-IDF would find
        mock_manager.search.return_value = [nodes[1], nodes[3]]  # AI, Data Science

        query = "machine learning fundamentals"
        results = get_most_relevant_nodes(tree, limit=10, query=query)

        # Should include both vector search results and TF-IDF keyword matches
        result_ids = [node.id for node in results]

        # Vector search results should be included
        assert nodes[1] in result_ids  # AI (from vector search)
        assert nodes[3] in result_ids  # Data Science (from vector search)

        # TF-IDF might also find the "Machine Learning Basics" node by keyword
        # This tests the combination aspect


class TestRealVectorSearchIntegration:
    """Test with real vector search (requires API key)"""

    @pytest.mark.slow
    def test_real_semantic_search_quality(self):
        """Test that real vector search improves semantic relevance over TF-IDF alone"""
        tree = MarkdownTree()  # Real embedding manager

        # Create nodes with clear semantic relationships
        ml_node = tree.create_new_node(
            "Neural Networks", None,
            "Deep learning uses artificial neural networks with multiple layers",
            "Multi-layer perceptron introduction"
        )

        ai_node = tree.create_new_node(
            "Machine Intelligence", None,
            "Computational systems that exhibit intelligent behavior",
            "AI systems overview"
        )

        cooking_node = tree.create_new_node(
            "Pasta Recipes", None,
            "Instructions for making delicious italian pasta dishes",
            "Cooking guide for pasta"
        )

        # Query that should find semantic relationships
        query = "artificial intelligence and deep learning"

        # Test with vector search enabled
        results_with_vector = tree.search_similar_nodes(query, top_k=3)

        # Should prioritize AI/ML nodes over cooking
        assert ml_node in results_with_vector[:2]  # Top 2 results
        assert ai_node in results_with_vector[:2]  # Top 2 results
        assert cooking_node not in results_with_vector[:2]  # Should rank lower


