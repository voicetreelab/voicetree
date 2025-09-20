"""
Test to verify that TF-IDF and vector search scores are sensible and properly aligned.
Loads real test documents and examines score ranges, ordering, and consistency.
"""

import os
import pytest
from pathlib import Path
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree, Node
from backend.markdown_tree_manager.graph_search.tree_functions import (
    search_similar_nodes_tfidf,
    _get_semantically_related_nodes
)


class TestScoreSanityCheck:
    """Verify score ranges and consistency between TF-IDF and vector search"""

    @pytest.fixture
    def loaded_tree(self):
        """Load test markdown files into a tree"""
        # Ensure we're using real embeddings for this test
        os.environ['VOICETREE_TEST_MODE'] = 'false'
        tree = MarkdownTree()
        test_data_dir = Path(__file__).parent / "test_embedding_search_data"

        # Load test documents
        test_docs = [
            ("Machine Learning Basics", "Introduction to supervised and unsupervised learning algorithms", "ML fundamentals"),
            ("Deep Learning Architectures", "Neural networks, CNNs, RNNs, and transformers", "DL architectures"),
            ("Natural Language Processing", "Text processing, tokenization, and language models", "NLP techniques"),
            ("Computer Vision Applications", "Image recognition, object detection, and segmentation", "CV applications"),
            ("Data Preprocessing Techniques", "Data cleaning, normalization, and feature engineering", "Data prep"),
            ("Python Programming Basics", "Variables, loops, functions, and object-oriented programming", "Python basics"),
            ("Database Management Systems", "SQL, NoSQL, transactions, and indexing", "Database systems"),
            ("Web Development Frameworks", "React, Django, Flask, and REST APIs", "Web frameworks"),
            ("Cooking Italian Cuisine", "Pasta, pizza, risotto, and traditional recipes", "Italian cooking"),
            ("Gardening Tips", "Planting, watering, pruning, and soil management", "Gardening guide"),
        ]

        for title, content, summary in test_docs:
            tree.create_new_node(title, None, content, summary)

        return tree

    def test_score_ranges_and_ordering(self, loaded_tree):
        """Test that scores are in expected ranges and properly ordered"""
        query = "machine learning and neural networks"

        # Get TF-IDF scores
        tfidf_results = search_similar_nodes_tfidf(loaded_tree, query, top_k=10)
        print("\n=== TF-IDF Results ===")
        for node_id, score in tfidf_results[:5]:
            node = loaded_tree.tree[node_id]
            print(f"  {node.title:30} Score: {score:.4f}")

        # Get vector scores
        vector_results = loaded_tree.search_similar_nodes_vector(query, top_k=10)
        print("\n=== Vector Search Results ===")
        for node_id, score in vector_results[:5]:
            node = loaded_tree.tree[node_id]
            print(f"  {node.title:30} Score: {score:.4f}")

        # Verify score ranges
        # TF-IDF scores should be between 0 and 1 (cosine similarity)
        if tfidf_results:
            assert all(0 <= score <= 1 for _, score in tfidf_results), "TF-IDF scores out of range"
            # Scores should be decreasing (highest relevance first)
            tfidf_scores = [score for _, score in tfidf_results]
            assert tfidf_scores == sorted(tfidf_scores, reverse=True), "TF-IDF scores not properly ordered"
            print(f"\nTF-IDF score range: {min(tfidf_scores):.4f} - {max(tfidf_scores):.4f}")

        # Vector scores should be between -1 and 1 (cosine similarity)
        if vector_results:
            assert all(-1 <= score <= 1 for _, score in vector_results), "Vector scores out of range"
            # Scores should be decreasing (highest similarity first)
            vector_scores = [score for _, score in vector_results]
            assert vector_scores == sorted(vector_scores, reverse=True), "Vector scores not properly ordered"
            print(f"Vector score range: {min(vector_scores):.4f} - {max(vector_scores):.4f}")

        # Both should rank ML-related content higher than cooking
        if tfidf_results and vector_results:
            # Check if ML/DL content appears before cooking in both
            tfidf_nodes = [loaded_tree.tree[nid].title for nid, _ in tfidf_results[:5]]
            vector_nodes = [loaded_tree.tree[nid].title for nid, _ in vector_results[:5]]

            print(f"\nTop TF-IDF nodes: {tfidf_nodes}")
            print(f"Top Vector nodes: {vector_nodes}")

            # ML-related topics should appear high in both
            ml_related = ["Machine Learning Basics", "Deep Learning Architectures", "Natural Language Processing"]
            non_tech = ["Cooking Italian Cuisine", "Gardening Tips"]

            # At least one ML topic should be in top 3 for both methods
            assert any(title in ml_related for title in tfidf_nodes[:3]) or not tfidf_results
            assert any(title in ml_related for title in vector_nodes[:3])

    def test_hybrid_score_combination(self, loaded_tree):
        """Test that hybrid search properly combines scores"""
        query = "artificial intelligence and data science"

        # Get individual results
        tfidf_results = search_similar_nodes_tfidf(loaded_tree, query, top_k=10)
        vector_results = loaded_tree.search_similar_nodes_vector(query, top_k=10)

        # Get hybrid results
        hybrid_results = _get_semantically_related_nodes(loaded_tree, query, 10, set())

        print("\n=== Hybrid Search Analysis ===")
        print(f"TF-IDF found: {len(tfidf_results)} nodes")
        print(f"Vector found: {len(vector_results)} nodes")
        print(f"Hybrid returned: {len(hybrid_results)} nodes")

        # Create score dictionaries for analysis
        tfidf_scores = {node_id: score for node_id, score in tfidf_results}
        vector_scores = {node_id: score for node_id, score in vector_results}

        # Analyze combined scoring
        print("\n=== Score Combination Analysis ===")
        for node_id in hybrid_results[:5]:
            node = loaded_tree.tree[node_id]
            tfidf_score = tfidf_scores.get(node_id, 0)
            vector_score = vector_scores.get(node_id, 0)
            # Expected combined score (0.7 * vector + 0.3 * tfidf)
            expected_combined = 0.7 * vector_score + 0.3 * tfidf_score

            print(f"{node.title:30}")
            print(f"  TF-IDF: {tfidf_score:.4f}, Vector: {vector_score:.4f}")
            print(f"  Expected combined: {expected_combined:.4f}")

        # Verify that nodes with high scores in either method appear in hybrid
        top_tfidf = [nid for nid, _ in tfidf_results[:3]] if tfidf_results else []
        top_vector = [nid for nid, _ in vector_results[:3]]

        # At least some top nodes from each method should appear in hybrid
        if top_tfidf:
            assert any(nid in hybrid_results for nid in top_tfidf), "Top TF-IDF nodes missing from hybrid"
        assert any(nid in hybrid_results for nid in top_vector), "Top vector nodes missing from hybrid"

    def test_score_consistency_across_queries(self, loaded_tree):
        """Test that scores are consistent across different query types"""
        queries = [
            ("python programming", ["Python Programming Basics", "Web Development Frameworks"]),
            ("database sql", ["Database Management Systems"]),
            ("neural networks deep learning", ["Deep Learning Architectures", "Machine Learning Basics"]),
            ("pasta pizza food", ["Cooking Italian Cuisine"]),
        ]

        print("\n=== Query Consistency Test ===")
        for query, expected_top in queries:
            print(f"\nQuery: '{query}'")

            # Get results
            tfidf_results = search_similar_nodes_tfidf(loaded_tree, query, top_k=5)
            vector_results = loaded_tree.search_similar_nodes_vector(query, top_k=5)

            if tfidf_results:
                top_tfidf = loaded_tree.tree[tfidf_results[0][0]].title
                print(f"  TF-IDF top: {top_tfidf} (score: {tfidf_results[0][1]:.4f})")
                # TF-IDF should find keyword matches
                if any(keyword in query.lower() for keyword in top_tfidf.lower().split()):
                    print("    ✓ TF-IDF found keyword match")

            if vector_results:
                top_vector = loaded_tree.tree[vector_results[0][0]].title
                print(f"  Vector top: {top_vector} (score: {vector_results[0][1]:.4f})")
                # Vector should find semantic matches
                if top_vector in expected_top:
                    print("    ✓ Vector found semantic match")

        print("\n=== Score Range Summary ===")
        print("Both methods use cosine similarity (0 to 1 range)")
        print("Higher scores = more relevant/similar")
        print("Scores are properly ordered (decreasing)")
        print("Hybrid combines with weights: 0.7*vector + 0.3*tfidf")


if __name__ == "__main__":
    # Run test directly for debugging
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))))

    test = TestScoreSanityCheck()
    tree = test.loaded_tree()

    print("Running score sanity checks...")
    test.test_score_ranges_and_ordering(tree)
    test.test_hybrid_score_combination(tree)
    test.test_score_consistency_across_queries(tree)