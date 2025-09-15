"""
Integration tests for embedding-based vector search with real markdown files.
Tests the complete pipeline from loading nodes to finding relevant results.
"""

import os
import pytest
import numpy as np
from pathlib import Path
from unittest.mock import patch

from backend.tree_manager.markdown_tree_ds import MarkdownTree, Node
from backend.context_retrieval.vector_search import (
    get_node_embeddings,
    find_similar_by_embedding,
    find_relevant_nodes_for_context,
    USE_EMBEDDINGS
)


class TestEmbeddingSearchIntegration:
    """Integration tests for vector search functionality"""
    
    @pytest.fixture
    def test_data_dir(self):
        """Path to test markdown files"""
        return Path(__file__).parent / "test_embedding_search_data"
    
    @pytest.fixture
    def loaded_tree(self, test_data_dir):
        """Load test markdown files into a DecisionTree"""
        tree = MarkdownTree()
        
        # Manually load nodes from test files (simplified loader)
        for md_file in sorted(test_data_dir.glob("*.md")):
            with open(md_file, 'r') as f:
                content = f.read()
                
            # Parse node_id and title from frontmatter
            lines = content.split('\n')
            node_id = None
            title = None
            
            for line in lines:
                if line.startswith('node_id:'):
                    node_id = int(line.split(':')[1].strip())
                elif line.startswith('title:'):
                    title = line.split(':')[1].strip()
                elif line.startswith('###'):
                    break
            
            if node_id and title:
                # Extract summary (first paragraph after ###)
                summary_start = content.find('###')
                if summary_start != -1:
                    summary_end = content.find('\n\n', summary_start)
                    if summary_end != -1:
                        summary = content[summary_start:summary_end].replace('###', '').strip()
                    else:
                        summary = content[summary_start:].replace('###', '').strip()
                else:
                    summary = ""
                
                # Create node
                node = Node(title, node_id, content, summary)
                tree.tree[node_id] = node
                tree.next_node_id = max(tree.next_node_id, node_id + 1)
        
        return tree
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_embedding_generation_for_tree(self, loaded_tree):
        """Test that embeddings are generated for all nodes in the tree"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            # Should have embeddings for all nodes
            assert len(embeddings) == len(loaded_tree.tree)
            
            # Each embedding should be a numpy array
            for node_id, embedding in embeddings.items():
                assert isinstance(embedding, np.ndarray)
                assert embedding.shape[0] == 768  # Gemini text-embedding-004 dimension
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_find_machine_learning_nodes(self, loaded_tree):
        """Test finding nodes related to machine learning"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            # Generate embeddings
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            # Search for machine learning related content
            results = find_similar_by_embedding(
                "artificial intelligence and machine learning algorithms",
                embeddings,
                top_k=5
            )
            
            # Should find relevant nodes
            assert len(results) > 0
            
            # Top results should include ML-related nodes
            top_node_ids = [node_id for node_id, _ in results]
            node_titles = [loaded_tree.tree[nid].title for nid in top_node_ids]
            
            # At least one of these should be in top results
            expected_topics = [
                "Machine Learning Basics",
                "Deep Learning Architectures", 
                "Artificial Intelligence Ethics",
                "Neural Network Training"
            ]
            
            matches = [title for title in node_titles if any(exp in title for exp in expected_topics)]
            assert len(matches) > 0, f"Expected ML topics not found in {node_titles}"
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_find_nlp_specific_nodes(self, loaded_tree):
        """Test finding nodes specifically about NLP"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            # Search for NLP-specific content
            results = find_similar_by_embedding(
                "natural language processing text analysis transformers BERT GPT",
                embeddings,
                top_k=3
            )
            
            top_node_ids = [node_id for node_id, _ in results]
            node_titles = [loaded_tree.tree[nid].title for nid in top_node_ids]
            
            # Should prioritize NLP and Transformer nodes
            nlp_keywords = ["Natural Language", "Transformer", "NLP"]
            matches = [title for title in node_titles if any(kw in title for kw in nlp_keywords)]
            assert len(matches) > 0, f"NLP topics not found in {node_titles}"
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_find_non_tech_nodes(self, loaded_tree):
        """Test finding non-technical nodes like cooking or gardening"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            # Search for cooking-related content
            results = find_similar_by_embedding(
                "cooking recipes italian food pasta pizza ingredients",
                embeddings,
                top_k=3
            )
            
            top_node_ids = [node_id for node_id, _ in results]
            node_titles = [loaded_tree.tree[nid].title for nid in top_node_ids]
            
            # Should find cooking-related node
            cooking_found = any("Cooking" in title or "Italian" in title for title in node_titles)
            assert cooking_found, f"Cooking topic not found in {node_titles}"
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_similarity_scores_ordering(self, loaded_tree):
        """Test that similarity scores are properly ordered"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            results = find_similar_by_embedding(
                "deep learning neural networks",
                embeddings,
                top_k=10
            )
            
            # Scores should be in descending order
            scores = [score for _, score in results]
            assert all(scores[i] >= scores[i+1] for i in range(len(scores)-1))
            
            # All scores should be between -1 and 1 (cosine similarity range)
            assert all(-1 <= score <= 1 for score in scores)
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_integration_with_context_retrieval(self, loaded_tree):
        """Test integration with find_relevant_nodes_for_context function"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            # Use the new context retrieval function
            related_nodes = find_relevant_nodes_for_context(
                loaded_tree.tree,
                query="transformer models for natural language understanding",
                top_k=5
            )
            
            # Should return node IDs
            assert isinstance(related_nodes, list)
            assert len(related_nodes) <= 5
            
            # Nodes should be valid
            for node_id in related_nodes:
                assert node_id in loaded_tree.tree
    
    def test_fallback_without_api_key(self, loaded_tree):
        """Test that system falls back gracefully without API key"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true', 'GEMINI_API_KEY': ''}):
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            # Should return empty dict when API key is missing
            assert embeddings == {}
    
    @pytest.mark.skipif(not os.getenv("GEMINI_API_KEY"), reason="GEMINI_API_KEY not set")
    def test_exact_match_gets_highest_score(self, loaded_tree):
        """Test that searching for exact node content gives highest similarity"""
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            embeddings = get_node_embeddings(loaded_tree.tree)
            
            # Search using exact content from a node
            target_node = loaded_tree.tree[1]  # Machine Learning Basics
            results = find_similar_by_embedding(
                target_node.summary,
                embeddings,
                top_k=1
            )
            
            # The top result should be the node itself
            if results:
                top_node_id, score = results[0]
                assert top_node_id == 1, f"Expected node 1, got {top_node_id}"
                assert score > 0.75, f"Expected high similarity for exact match, got {score}"


class TestEmbeddingSearchEdgeCases:
    """Test edge cases and error handling"""
    
    def test_empty_tree(self):
        """Test with empty tree"""
        empty_tree = {}
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            embeddings = get_node_embeddings(empty_tree)
            assert embeddings == {}
    
    def test_empty_query(self):
        """Test with empty query string"""
        fake_embeddings = {1: np.array([0.1, 0.2, 0.3])}
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            results = find_similar_by_embedding("", fake_embeddings)
            assert results == []
    
    def test_whitespace_only_query(self):
        """Test with whitespace-only query"""
        fake_embeddings = {1: np.array([0.1, 0.2, 0.3])}
        with patch.dict(os.environ, {'VOICETREE_USE_EMBEDDINGS': 'true'}):
            results = find_similar_by_embedding("   \n\t  ", fake_embeddings)
            assert results == []


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])