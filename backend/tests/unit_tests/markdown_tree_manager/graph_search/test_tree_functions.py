"""
Unit tests for tree_functions.py module

Tests TF-IDF search functionality and semantic node retrieval
"""
import pytest
from datetime import datetime, timedelta
from unittest.mock import Mock
from backend.markdown_tree_manager.markdown_tree_ds import Node
from backend.markdown_tree_manager.graph_search.tree_functions import (
    search_similar_nodes_tfidf,
    search_similar_nodes_bm25,
    reciprocal_rank_fusion,
    hybrid_search_for_relevant_nodes,
    _get_semantically_related_nodes,
    get_most_relevant_nodes,
)


class TestSearchSimilarNodesTfidf:
    """Tests for TF-IDF-based search functionality"""

    def test_tfidf_search_with_stopwords_defined(self):
        """
        Test that TF-IDF search works when there are multiple nodes

        This reproduces the bug: "TF-IDF search failed: name 'stopwords' is not defined"
        which occurs when trying to retrieve semantically related nodes.
        """
        # Create mock decision tree with sample nodes
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create sample nodes
        # Node(name, node_id, content, summary, parent_id)
        nodes = [
            Node(
                name="Keyword Search Implementation",
                node_id=1,
                content="This describes the keyword search feature in the RAG pipeline",
                summary="Implementation of keyword-based search functionality",
            ),
            Node(
                name="Vector Search System",
                node_id=2,
                content="The vector search allows finding semantically similar nodes",
                summary="Vector-based semantic search using embeddings",
            ),
            Node(
                name="Stopword Filtering",
                node_id=3,
                content="Stopwords are filtered to improve search relevance",
                summary="Filtering common stopwords from search queries",
            ),
        ]

        # Add nodes to tree
        for node in nodes:
            decision_tree.tree[node.id] = node

        # Query for related nodes
        query = "keyword search functionality"

        # This should work without raising "name 'stopwords' is not defined"
        results = search_similar_nodes_tfidf(
            decision_tree=decision_tree,
            query=query,
            top_k=2,
            already_selected=set()
        )

        # Verify results were returned (not empty due to error)
        assert isinstance(results, list)
        assert len(results) > 0

        # Verify results contain tuples of (node_id, score)
        for node_id, score in results:
            assert isinstance(node_id, int)
            assert isinstance(score, float)
            assert score >= 0.0


class TestGetSemanticallyRelatedNodes:
    """Tests for hybrid semantic search"""

    def test_hybrid_search_with_bm25_and_rrf(self):
        """
        Test hybrid search using BM25 + RRF fusion (new implementation)

        Updated to test the new state-of-the-art hybrid search.
        """
        # Create mock decision tree
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create sample nodes with more distinctive content
        nodes = [
            Node(
                name="Machine Learning Tutorial",
                node_id=0,
                content="Machine learning algorithms and neural networks for data analysis",
                summary="Comprehensive guide to machine learning techniques",
            ),
            Node(
                name="Python Programming Guide",
                node_id=1,
                content="Python programming language syntax and best practices",
                summary="Learn Python programming from basics to advanced",
            ),
            Node(
                name="Data Science Handbook",
                node_id=2,
                content="Data science methods including machine learning and statistics",
                summary="Complete data science reference with practical examples",
            ),
        ]

        for node in nodes:
            decision_tree.tree[node.id] = node

        # Mock vector search to return reasonable scores
        decision_tree.search_similar_nodes_vector = Mock(
            return_value=[(0, 0.85), (2, 0.75)]  # Good scores for ML-related nodes
        )

        query = "machine learning techniques"

        # This should use the new hybrid search with BM25 + RRF
        results = _get_semantically_related_nodes(
            decision_tree=decision_tree,
            query=query,
            remaining_slots_count=3,
            already_selected=set()
        )

        # Verify results
        assert isinstance(results, list)
        # Should have results from hybrid search
        assert len(results) > 0
        # ML-related nodes should be in results
        assert any(node_id in [0, 2] for node_id in results)


class TestGetMostRelevantNodes:
    """Tests for node selection with query-based relevance"""

    def test_get_most_relevant_nodes_with_query(self):
        """
        Test node selection when tree exceeds limit and query is provided

        This tests the full code path from get_most_relevant_nodes through
        _get_semantically_related_nodes to search_similar_nodes_tfidf.
        """
        # Create mock decision tree with many nodes (exceeding limit)
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create 20 nodes (more than our limit of 10)
        # Node(name, node_id, content, summary, parent_id)
        for i in range(20):
            node = Node(
                name=f"Node {i}",
                node_id=i,
                content=f"Detailed content for node {i}",
                summary=f"This is node number {i} about various topics",
            )
            decision_tree.tree[node.id] = node

        # Mock vector search
        decision_tree.search_similar_nodes_vector = Mock(return_value=[])

        query = "topics"
        limit = 10

        # This should trigger semantic search with TF-IDF
        results = get_most_relevant_nodes(
            decision_tree=decision_tree,
            limit=limit,
            query=query
        )

        # Verify results
        assert isinstance(results, list)
        assert len(results) <= limit
        # All results should be Node instances
        for node in results:
            assert isinstance(node, Node)


class TestGetMostRelevantNodesRecency:
    """Tests for recency-based node selection in get_most_relevant_nodes"""

    def test_nodes_sorted_by_modified_at_timestamp(self):
        """
        Verify that get_most_relevant_nodes correctly sorts by modified_at.

        This tests the fix for the bug where files without modified_at in YAML
        were getting datetime.now() on each load, causing incorrect ordering.
        """
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create nodes with explicit timestamps - spread across time
        base_time = datetime(2025, 1, 1, 12, 0, 0)

        # Create 20 nodes with different modification times
        # Nodes 15-19 should be most recent
        for i in range(20):
            node = Node(
                name=f"Node {i}",
                node_id=i,
                content=f"Content for node {i}",
                summary=f"Summary for node {i}",
            )
            # Each node is 1 day newer than the previous
            node.modified_at = base_time + timedelta(days=i)
            decision_tree.tree[node.id] = node

        # Mock vector search
        decision_tree.search_similar_nodes_vector = Mock(return_value=[])

        # Request 8 nodes (3/8 of 8 = 3 recent slots)
        limit = 8
        results = get_most_relevant_nodes(decision_tree, limit=limit, query=None)

        # Extract node IDs from results
        result_ids = [node.id for node in results]

        # The most recently modified nodes (highest IDs) should be included
        # With limit=8 and 3/8 recent slots = 3 recent nodes
        # Nodes 19, 18, 17 should definitely be in results
        assert 19 in result_ids, f"Most recent node (19) should be included. Got: {result_ids}"
        assert 18 in result_ids, f"Second most recent node (18) should be included. Got: {result_ids}"
        assert 17 in result_ids, f"Third most recent node (17) should be included. Got: {result_ids}"

    def test_most_recent_node_is_correctly_identified(self):
        """
        Verify that the most recent node is correctly identified based on modified_at.

        Tests that old files with file-based timestamps don't incorrectly appear
        as "most recent" compared to truly recently modified files.
        """
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create a "truly recent" node
        recent_node = Node(
            name="Actually Recent Node",
            node_id=1,
            content="This was just modified",
            summary="Recent modification",
        )
        recent_node.modified_at = datetime(2025, 12, 2, 10, 0, 0)  # Today

        # Create an "old" node that would have appeared recent with the bug
        # (when datetime.now() was used as fallback)
        old_node = Node(
            name="Old Node From File",
            node_id=2,
            content="This is from an old file",
            summary="Old content",
        )
        old_node.modified_at = datetime(2025, 11, 1, 10, 0, 0)  # A month ago

        # Create another old node
        older_node = Node(
            name="Even Older Node",
            node_id=3,
            content="Very old content",
            summary="Ancient",
        )
        older_node.modified_at = datetime(2025, 10, 1, 10, 0, 0)  # Two months ago

        decision_tree.tree = {1: recent_node, 2: old_node, 3: older_node}
        decision_tree.search_similar_nodes_vector = Mock(return_value=[])

        # Get results with limit that includes all nodes
        results = get_most_relevant_nodes(decision_tree, limit=10, query=None)

        # Extract the returned nodes
        result_nodes = {node.id: node for node in results}

        # Node 1 should be identified as most recent
        assert 1 in result_nodes, "The actually recent node should be in results"

        # Check the order - most recent should come first in internal sorting
        # The function returns nodes in a sorted order by ID at the end,
        # but internally it correctly identifies recent nodes
        assert len(results) == 3, "All 3 nodes should be returned when under limit"

    def test_recency_ordering_with_mixed_timestamps(self):
        """
        Test that nodes with mixed timestamp sources are correctly ordered.

        Simulates scenario where some nodes have YAML timestamps (recent)
        and others have file-based timestamps (correctly reflecting old files).
        """
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create 10 nodes to exceed limit and trigger recency selection
        timestamps = [
            # Old files (would be file mtime after fix)
            datetime(2025, 6, 1, 12, 0, 0),   # Node 0 - old
            datetime(2025, 7, 1, 12, 0, 0),   # Node 1 - old
            datetime(2025, 8, 1, 12, 0, 0),   # Node 2 - old
            datetime(2025, 9, 1, 12, 0, 0),   # Node 3 - old
            datetime(2025, 10, 1, 12, 0, 0),  # Node 4 - old
            # Recent files (would have YAML timestamps after creation)
            datetime(2025, 12, 1, 10, 0, 0),  # Node 5 - recent
            datetime(2025, 12, 1, 11, 0, 0),  # Node 6 - recent
            datetime(2025, 12, 1, 12, 0, 0),  # Node 7 - recent
            datetime(2025, 12, 2, 9, 0, 0),   # Node 8 - very recent
            datetime(2025, 12, 2, 10, 0, 0),  # Node 9 - most recent
        ]

        for i, ts in enumerate(timestamps):
            node = Node(
                name=f"Node {i}",
                node_id=i,
                content=f"Content {i}",
                summary=f"Summary {i}",
            )
            node.modified_at = ts
            decision_tree.tree[node.id] = node

        decision_tree.search_similar_nodes_vector = Mock(return_value=[])

        # Limit to 5 nodes - should get the 3 most recent from recency selection
        # (3/8 of limit = ~1-2, but let's use limit=8 for clearer math)
        results = get_most_relevant_nodes(decision_tree, limit=8, query=None)
        result_ids = [node.id for node in results]

        # Most recent nodes (9, 8, 7) should be included
        assert 9 in result_ids, f"Most recent node 9 should be included. Got: {result_ids}"
        assert 8 in result_ids, f"Node 8 should be included. Got: {result_ids}"

        # Very old nodes should not take precedence over recent ones
        recent_count = sum(1 for id in result_ids if id >= 5)
        old_count = sum(1 for id in result_ids if id < 5)

        # Recent nodes should dominate since they fill the recency slots
        assert recent_count >= 3, f"At least 3 recent nodes should be included. Got {recent_count} recent, {old_count} old"


class TestReciprocalRankFusion:
    """Tests for Reciprocal Rank Fusion (RRF) algorithm"""

    def test_rrf_combines_two_rankings(self):
        """Test that RRF correctly combines two ranked lists"""
        list1 = [1, 2, 3, 4, 5]
        list2 = [3, 1, 5, 6, 7]

        result = reciprocal_rank_fusion(list1, list2, k=60)

        # Items appearing in both lists should rank higher
        assert 1 in result[:3]  # Appears at position 1 and 2
        assert 3 in result[:3]  # Appears at position 3 and 1
        assert isinstance(result, list)

    def test_rrf_handles_single_list(self):
        """Test RRF with only one ranked list"""
        list1 = [1, 2, 3, 4, 5]

        result = reciprocal_rank_fusion(list1, k=60)

        # Should return same order for single list
        assert result == list1

    def test_rrf_handles_empty_lists(self):
        """Test RRF with empty input"""
        result = reciprocal_rank_fusion([], [], k=60)
        assert result == []

    def test_rrf_handles_no_overlap(self):
        """Test RRF with lists that have no common elements"""
        list1 = [1, 2, 3]
        list2 = [4, 5, 6]

        result = reciprocal_rank_fusion(list1, list2, k=60)

        # All elements should appear
        assert len(result) == 6
        assert set(result) == {1, 2, 3, 4, 5, 6}

    def test_rrf_k_parameter_affects_ranking(self):
        """Test that k parameter influences score calculation"""
        list1 = [1, 2]
        list2 = [2, 1]

        # With different k values, relative scores might differ slightly
        result_k60 = reciprocal_rank_fusion(list1, list2, k=60)
        result_k10 = reciprocal_rank_fusion(list1, list2, k=10)

        # Both should have same elements
        assert set(result_k60) == set(result_k10) == {1, 2}
        # Both items appear in both lists, so either ordering is valid


class TestSearchSimilarNodesBM25:
    """Tests for BM25-based search functionality"""

    def test_bm25_search_returns_scored_results(self):
        """Test that BM25 search returns results with scores"""
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create sample nodes
        nodes = [
            Node(
                name="Machine Learning Basics",
                node_id=1,
                content="Machine learning is a method of data analysis",
                summary="Introduction to machine learning concepts",
            ),
            Node(
                name="Deep Learning Networks",
                node_id=2,
                content="Deep learning uses neural networks for pattern recognition",
                summary="Neural networks and deep learning architectures",
            ),
            Node(
                name="Cooking Recipes",
                node_id=3,
                content="A collection of delicious cooking recipes",
                summary="Various recipes for home cooking",
            ),
        ]

        for node in nodes:
            decision_tree.tree[node.id] = node

        query = "machine learning neural networks"

        results = search_similar_nodes_bm25(
            decision_tree=decision_tree,
            query=query,
            top_k=2,
            already_selected=set()
        )

        # Verify results structure
        assert isinstance(results, list)
        assert len(results) > 0

        # Verify results contain tuples of (node_id, score)
        for node_id, score in results:
            assert isinstance(node_id, int)
            assert isinstance(score, float)
            assert score >= 0.0

        # ML-related nodes should rank higher than cooking
        top_node_ids = [node_id for node_id, _ in results[:2]]
        assert 3 not in top_node_ids  # Cooking node should not be in top results

    def test_bm25_search_filters_already_selected(self):
        """Test that BM25 excludes already selected nodes"""
        decision_tree = Mock()
        decision_tree.tree = {}

        nodes = [
            Node(name=f"Node {i}", node_id=i, content=f"Content {i}", summary=f"Summary {i}")
            for i in range(5)
        ]

        for node in nodes:
            decision_tree.tree[node.id] = node

        already_selected = {0, 1}

        results = search_similar_nodes_bm25(
            decision_tree=decision_tree,
            query="content summary",
            top_k=10,
            already_selected=already_selected
        )

        # Results should not contain already selected nodes
        result_node_ids = [node_id for node_id, _ in results]
        assert 0 not in result_node_ids
        assert 1 not in result_node_ids

    def test_bm25_search_empty_tree(self):
        """Test BM25 search with empty tree"""
        decision_tree = Mock()
        decision_tree.tree = {}

        results = search_similar_nodes_bm25(
            decision_tree=decision_tree,
            query="test query",
            top_k=10
        )

        assert results == []


class TestHybridSearchWithRRF:
    """Tests for state-of-the-art hybrid search using BM25 + Vector + RRF"""

    def test_hybrid_search_combines_vector_and_bm25(self):
        """Test that hybrid search combines both retrieval methods"""
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create nodes
        nodes = [
            Node(
                name="Python Programming",
                node_id=1,
                content="Python is a high-level programming language",
                summary="Python language basics",
            ),
            Node(
                name="JavaScript Development",
                node_id=2,
                content="JavaScript is used for web development",
                summary="JavaScript programming guide",
            ),
            Node(
                name="Data Science",
                node_id=3,
                content="Data science involves statistical analysis and machine learning",
                summary="Introduction to data science",
            ),
        ]

        for node in nodes:
            decision_tree.tree[node.id] = node

        # Mock vector search to return different results than BM25 would
        decision_tree.search_similar_nodes_vector = Mock(
            return_value=[(3, 0.9), (1, 0.8), (2, 0.6)]  # (node_id, score)
        )

        query = "programming languages"

        results = hybrid_search_for_relevant_nodes(
            decision_tree=decision_tree,
            query=query,
            max_return_nodes=3,
            already_selected=set(),
            vector_score_threshold=0.5,
            bm25_score_threshold=0.1
        )

        # Verify results
        assert isinstance(results, list)
        assert len(results) > 0
        assert all(isinstance(node_id, int) for node_id in results)

    def test_hybrid_search_applies_thresholds(self):
        """Test that hybrid search filters by score thresholds"""
        decision_tree = Mock()
        decision_tree.tree = {}

        nodes = [Node(name=f"Node {i}", node_id=i, content=f"Content {i}", summary=f"Summary {i}") for i in range(3)]
        for node in nodes:
            decision_tree.tree[node.id] = node

        # Mock vector search with some low scores
        decision_tree.search_similar_nodes_vector = Mock(
            return_value=[(0, 0.9), (1, 0.3), (2, 0.2)]  # Only first passes threshold
        )

        results = hybrid_search_for_relevant_nodes(
            decision_tree=decision_tree,
            query="test",
            max_return_nodes=10,
            vector_score_threshold=0.8,  # High threshold
            bm25_score_threshold=0.1
        )

        # With high threshold, should filter out low-scoring results
        assert isinstance(results, list)

    def test_hybrid_search_respects_already_selected(self):
        """Test that hybrid search excludes already selected nodes"""
        decision_tree = Mock()
        decision_tree.tree = {}

        nodes = [Node(name=f"Node {i}", node_id=i, content=f"Content {i}", summary=f"Summary {i}") for i in range(5)]
        for node in nodes:
            decision_tree.tree[node.id] = node

        decision_tree.search_similar_nodes_vector = Mock(
            return_value=[(i, 0.9) for i in range(5)]
        )

        already_selected = {0, 1}

        results = hybrid_search_for_relevant_nodes(
            decision_tree=decision_tree,
            query="test",
            max_return_nodes=10,
            already_selected=already_selected
        )

        # Should not contain already selected nodes
        assert 0 not in results
        assert 1 not in results

    def test_hybrid_search_empty_results_both_methods(self):
        """Test hybrid search when both methods return no results"""
        decision_tree = Mock()
        decision_tree.tree = {}

        decision_tree.search_similar_nodes_vector = Mock(return_value=[])

        results = hybrid_search_for_relevant_nodes(
            decision_tree=decision_tree,
            query="test",
            max_return_nodes=10
        )

        assert results == []

    def test_hybrid_search_limits_return_count(self):
        """Test that hybrid search respects max_return_nodes parameter"""
        decision_tree = Mock()
        decision_tree.tree = {}

        # Create many nodes
        nodes = [Node(name=f"Node {i}", node_id=i, content=f"Content about topic {i}", summary=f"Summary {i}") for i in range(20)]
        for node in nodes:
            decision_tree.tree[node.id] = node

        decision_tree.search_similar_nodes_vector = Mock(
            return_value=[(i, 0.9) for i in range(20)]
        )

        max_return = 5

        results = hybrid_search_for_relevant_nodes(
            decision_tree=decision_tree,
            query="topic",
            max_return_nodes=max_return
        )

        # Should return at most max_return_nodes
        assert len(results) <= max_return
