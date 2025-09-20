"""
Unit tests for embedding-based search functionality
"""

import pytest
import numpy as np
from unittest.mock import patch
import os

from backend.markdown_tree_manager.graph_search.vector_search import (
    get_node_embeddings,
    find_similar_by_embedding,
    hybrid_search,
    extract_key_entities
)
from backend.markdown_tree_manager.markdown_tree_ds import Node


class TestEmbeddingGeneration:
    """Tests for node embedding generation"""
    
    @patch('backend.markdown_tree_manager.graph_search.vector_search.genai')
    def test_get_node_embeddings_basic(self, mock_genai):
        """Test basic embedding generation for nodes"""
        # Setup mock genai
        mock_genai.embed_content.return_value = {'embedding': [0.1, 0.2, 0.3] * 256}  # 768 dims
        mock_genai.configure.return_value = None
        
        # Create test nodes
        nodes = {
            1: Node("Machine Learning", 1, "Content about ML", "Introduction to ML"),
            2: Node("Deep Learning", 2, "Content about DL", "Neural networks")
        }
        
        # Generate embeddings
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': 'test'}):
            embeddings = get_node_embeddings(nodes)
        
        # Verify
        assert len(embeddings) == 2
        assert 1 in embeddings
        assert 2 in embeddings
        assert isinstance(embeddings[1], np.ndarray)
        assert embeddings[1].shape[0] == 768
        assert mock_genai.embed_content.call_count == 2
    
    @patch('backend.markdown_tree_manager.graph_search.vector_search.genai')
    def test_get_node_embeddings_empty_nodes(self, mock_genai):
        """Test embedding generation with empty node dictionary"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': 'test'}):
            embeddings = get_node_embeddings({})
        
        assert embeddings == {}
        mock_genai.embed_content.assert_not_called()
    
    @patch('backend.markdown_tree_manager.graph_search.vector_search.genai')
    def test_get_node_embeddings_weighted_text(self, mock_genai):
        """Test that text is properly weighted (title 3x, summary 2x, content 1x)"""
        mock_genai.embed_content.return_value = {'embedding': [0.1] * 768}
        mock_genai.configure.return_value = None
        
        nodes = {
            1: Node("Title", 1, "Content here", "Summary text")
        }
        
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': 'test'}):
            get_node_embeddings(nodes)
        
        # Check the text passed to embed_content includes weighted repetitions
        call_args = mock_genai.embed_content.call_args
        content = call_args[1]['content']
        assert content.count("Title") == 3  # Title repeated 3 times
        assert content.count("Summary text") == 2  # Summary repeated 2 times


class TestSimilaritySearch:
    """Tests for finding similar nodes using embeddings"""
    
    @patch('backend.markdown_tree_manager.graph_search.vector_search.genai')
    def test_find_similar_by_embedding_basic(self, mock_genai):
        """Test basic similarity search"""
        # Setup mock genai
        query_embedding = [0.5, 0.5, 0.5]
        mock_genai.embed_content.return_value = {'embedding': query_embedding}
        mock_genai.configure.return_value = None
        
        # Create node embeddings with varying similarities
        node_embeddings = {
            1: np.array([0.6, 0.6, 0.6]),  # High similarity
            2: np.array([0.1, 0.1, 0.1]),  # Low similarity
            3: np.array([0.5, 0.5, 0.5]),  # Perfect match
            4: np.array([-0.5, -0.5, -0.5])  # Negative correlation
        }
        
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': 'test'}):
            results = find_similar_by_embedding(
                "test query", node_embeddings, top_k=3, threshold=0.5
            )
        
        # Verify results are sorted by similarity
        assert len(results) <= 3
        assert results[0][0] == 3  # Perfect match should be first
        assert all(score >= 0.5 for _, score in results)  # All above threshold
        assert all(results[i][1] >= results[i+1][1] for i in range(len(results)-1))  # Descending order
    
    @patch('backend.markdown_tree_manager.graph_search.vector_search.genai')
    def test_find_similar_by_embedding_threshold(self, mock_genai):
        """Test that threshold filtering works correctly"""
        mock_genai.embed_content.return_value = {'embedding': [1.0, 0.0, 0.0]}
        mock_genai.configure.return_value = None
        
        node_embeddings = {
            1: np.array([1.0, 0.0, 0.0]),  # Similarity = 1.0
            2: np.array([0.7, 0.7, 0.0]),  # Similarity ~0.7
            3: np.array([0.0, 1.0, 0.0]),  # Similarity = 0.0
        }
        
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': 'test'}):
            results = find_similar_by_embedding(
                "test", node_embeddings, top_k=10, threshold=0.5
            )
        
        # Only nodes 1 and 2 should pass threshold
        assert len(results) == 2
        assert 3 not in [node_id for node_id, _ in results]
    
    def test_find_similar_by_embedding_empty_query(self):
        """Test that empty query returns no results"""
        node_embeddings = {1: np.array([0.1, 0.2, 0.3])}
        
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': 'test'}):
            results = find_similar_by_embedding("", node_embeddings)
        
        assert results == []


class TestHybridSearch:
    """Tests for hybrid TF-IDF + embedding search"""
    
    def test_hybrid_search_combines_results(self):
        """Test that hybrid search properly combines TF-IDF and embedding results"""
        tfidf_results = [1, 2, 3]
        embedding_results = [(2, 0.9), (4, 0.8), (5, 0.7)]
        
        combined = hybrid_search(
            "test query", tfidf_results, embedding_results, alpha=0.5
        )
        
        # Should contain all unique node IDs
        assert set(combined) == {1, 2, 3, 4, 5}
        
        # Node 2 should rank high (appears in both)
        assert 2 in combined[:2]
    
    def test_hybrid_search_alpha_weighting(self):
        """Test that alpha parameter correctly weights results"""
        tfidf_results = [1, 2]
        embedding_results = [(3, 1.0), (4, 0.9)]
        
        # Alpha = 0: Only TF-IDF matters
        combined_tfidf = hybrid_search(
            "test", tfidf_results, embedding_results, alpha=0.0
        )
        assert combined_tfidf[:2] == [1, 2]
        
        # Alpha = 1: Only embeddings matter
        combined_embedding = hybrid_search(
            "test", tfidf_results, embedding_results, alpha=1.0
        )
        assert combined_embedding[:2] == [3, 4]
    
    def test_hybrid_search_no_embeddings(self):
        """Test fallback when no embedding results"""
        tfidf_results = [1, 2, 3]
        
        combined = hybrid_search("test", tfidf_results, [], alpha=0.5)
        
        assert combined == tfidf_results


class TestEntityExtraction:
    """Tests for key entity extraction"""
    
    def test_extract_key_entities_names(self):
        """Test extraction of character names"""
        text = "Alice went to the store. Bob mentioned that Carol has been visiting."
        
        entities = extract_key_entities(text)
        
        assert "Alice" in entities
        assert "Bob" in entities
        assert "Carol" in entities
    
    def test_extract_key_entities_with_patterns(self):
        """Test extraction using character action patterns"""
        text = "David said hello. Emma was surprised. Frank went home."
        
        entities = extract_key_entities(text)
        
        assert "David" in entities
        assert "Emma" in entities
        assert "Frank" in entities
    
    def test_extract_key_entities_deduplication(self):
        """Test that entities are deduplicated"""
        text = "Grace visited the park. Grace mentioned Grace's friend."
        
        entities = extract_key_entities(text)
        
        # Grace should appear only once
        assert entities.count("Grace") == 1
    
    def test_extract_key_entities_preserves_order(self):
        """Test that entity order is preserved"""
        text = "Zoe met Ava. Bob came later."
        
        entities = extract_key_entities(text)
        
        # Zoe should come before Bob (order of appearance)
        zoe_idx = entities.index("Zoe") if "Zoe" in entities else -1
        bob_idx = entities.index("Bob") if "Bob" in entities else -1
        
        if zoe_idx >= 0 and bob_idx >= 0:
            assert zoe_idx < bob_idx


if __name__ == "__main__":
    pytest.main([__file__, "-v"])