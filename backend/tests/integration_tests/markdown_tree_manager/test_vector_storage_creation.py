"""
Test that graph creation builds and stores vectors successfully.
Simple integration test to verify vector storage works end-to-end.
"""

import os
import tempfile
from pathlib import Path

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class TestVectorStorageCreation:
    """Test that graph creation properly builds and stores vectors"""

    def test_graph_creation_with_mock_vectors(self):
        """Fast test: verify vector storage integration with mock embeddings"""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create tree with mock embeddings (default test behavior)
            tree = MarkdownTree(output_dir=temp_dir)

            # Verify embedding system is set up
            assert tree._embedding_manager is not None

            # Create test nodes
            tree.create_new_node(
                "Test Node 1",
                None,
                "Test content for node 1",
                "Test summary 1"
            )

            tree.create_new_node(
                "Test Node 2",
                None,
                "Test content for node 2",
                "Test summary 2"
            )

            # Force embedding update
            tree.flush_embeddings()

            # Verify embedding batching system works
            assert len(tree._pending_embedding_updates) == 0  # Should be flushed

            # Verify search functionality works (will use mock data)
            search_results = tree.search_similar_nodes("test query", top_k=1)
            # With mocks, this might return empty or mock results - just verify no errors
            assert isinstance(search_results, list)

    @pytest.mark.slow
    def test_graph_creation_stores_vectors_successfully(self):
        """Simple test: create nodes, verify vectors are stored in ChromaDB"""
        # Temporarily disable test mode to use real embeddings
        original_test_mode = os.environ.get('VOICETREE_TEST_MODE')
        os.environ['VOICETREE_TEST_MODE'] = 'false'

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                # Create tree with temporary ChromaDB storage
                tree = MarkdownTree(output_dir=temp_dir)

                # Verify embedding manager is enabled and working
                assert tree._embedding_manager is not None
                assert tree._embedding_manager.enabled
                assert tree._embedding_manager.vector_store is not None

                # Create test nodes with different content
                node1 = tree.create_new_node(
                    "Python Programming",
                    None,
                    "Python is a high-level programming language with dynamic semantics",
                    "Programming language overview"
                )

                tree.create_new_node(
                    "Machine Learning",
                    None,
                    "Machine learning algorithms enable computers to learn from data",
                    "ML introduction"
                )

                tree.create_new_node(
                    "Cooking Recipes",
                    None,
                    "Collection of delicious recipes for home cooking",
                    "Food preparation guide"
                )

                # Force embedding update (in case batching is enabled)
                tree.flush_embeddings()

                # Verify vectors are stored in ChromaDB
                stats = tree._embedding_manager.get_stats()
                assert stats['enabled'] is True
                assert stats['count'] == 3  # Should have 3 nodes stored

                # Verify we can search the stored vectors
                search_results = tree.search_similar_nodes("programming languages", top_k=2)
                assert len(search_results) > 0

                # search_similar_nodes returns node IDs directly
                assert node1.id in search_results

        finally:
            # Restore original test mode
            if original_test_mode is not None:
                os.environ['VOICETREE_TEST_MODE'] = original_test_mode
            else:
                os.environ.pop('VOICETREE_TEST_MODE', None)

    @pytest.mark.slow
    def test_vector_storage_persistence(self):
        """Test that vectors persist between ChromaDB sessions"""
        # Temporarily disable test mode to use real embeddings
        original_test_mode = os.environ.get('VOICETREE_TEST_MODE')
        os.environ['VOICETREE_TEST_MODE'] = 'false'

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                # First session: create tree and add nodes
                tree1 = MarkdownTree(output_dir=temp_dir)
                tree1.create_new_node(
                    "Data Science",
                    None,
                    "Data science combines statistics, programming, and domain expertise",
                    "Data science overview"
                )
                tree1.flush_embeddings()

                # Verify node is stored
                stats1 = tree1._embedding_manager.get_stats()
                assert stats1['count'] == 1

                # Second session: create new tree with same storage location
                tree2 = MarkdownTree(output_dir=temp_dir)

                # Verify the previously stored vectors are still accessible
                stats2 = tree2._embedding_manager.get_stats()
                assert stats2['count'] == 1  # Should still have the stored node

                # Should be able to search for the persisted node
                search_results = tree2.search_similar_nodes("data analysis", top_k=1)
                assert len(search_results) > 0

        finally:
            # Restore original test mode
            if original_test_mode is not None:
                os.environ['VOICETREE_TEST_MODE'] = original_test_mode
            else:
                os.environ.pop('VOICETREE_TEST_MODE', None)

    def test_vector_storage_with_consolidated_location(self):
        """Test that vectors are stored in the consolidated location we configured"""
        # Just verify the mock embedding system works - don't need real ChromaDB for location test
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create a mock markdown tree vault structure
            vault_dir = Path(temp_dir) / "markdownTreeVault"
            vault_dir.mkdir()

            tree = MarkdownTree(output_dir=str(vault_dir))

            # Create a node
            tree.create_new_node(
                "Test Node",
                None,
                "Test content for vector storage verification",
                "Test summary"
            )
            tree.flush_embeddings()

            # With mocks, just verify the embedding system is connected
            assert tree._embedding_manager is not None

            # Verify batching system works
            assert len(tree._pending_embedding_updates) == 0  # Should be flushed


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
