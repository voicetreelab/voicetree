"""
Test async embedding behavior in MarkdownTree.
"""

import unittest
from unittest.mock import Mock, patch
import time

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class TestEmbeddingAsync(unittest.TestCase):
    """Test that embeddings are updated asynchronously without blocking"""

    def test_embedding_updates_are_async(self):
        """Test that embeddings are submitted to executor immediately"""
        # Create a mock embedding manager
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()

        # Create tree with mock manager
        tree = MarkdownTree(embedding_manager=mock_manager)

        # Mock the executor to track submissions
        with patch.object(tree._embedding_executor, 'submit') as mock_submit:
            mock_future = Mock()
            mock_submit.return_value = mock_future

            # Create nodes - each should trigger async update
            node1 = tree.create_new_node("Node 1", None, "Content 1", "Summary 1")
            self.assertEqual(mock_submit.call_count, 1)

            node2 = tree.create_new_node("Node 2", None, "Content 2", "Summary 2")
            self.assertEqual(mock_submit.call_count, 2)

            # Each call should be for a single node
            first_call = mock_submit.call_args_list[0]
            second_call = mock_submit.call_args_list[1]

            # Verify single nodes are being updated
            self.assertEqual(len(first_call[0][1]), 1)  # First arg is function, second is dict
            self.assertEqual(len(second_call[0][1]), 1)

    def test_search_works_without_flushing(self):
        """Test that search operations work immediately without waiting"""
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()
        mock_manager.search = Mock(return_value=[1, 2, 3])

        tree = MarkdownTree(embedding_manager=mock_manager)

        # Create a node (async update)
        tree.create_new_node("Node 1", None, "Content 1", "Summary 1")

        # Search should work immediately without waiting
        results = tree.search_similar_nodes("test query")

        # Search should be called without delay
        mock_manager.search.assert_called_once_with("test query", 10)
        self.assertEqual(results, [1, 2, 3])

    def test_update_with_embeddings_false_skips_async(self):
        """Test that update_node with update_embeddings=False doesn't trigger async update"""
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()

        tree = MarkdownTree(embedding_manager=mock_manager)

        # Mock the executor
        with patch.object(tree._embedding_executor, 'submit') as mock_submit:
            mock_future = Mock()
            mock_submit.return_value = mock_future

            # Create a node - should trigger async
            node1 = tree.create_new_node("Node 1", None, "Content 1", "Summary 1")
            self.assertEqual(mock_submit.call_count, 1)

            # Update with embeddings=False - should NOT trigger
            tree.update_node(node1, "Updated content", "Updated summary", update_embeddings=False)
            self.assertEqual(mock_submit.call_count, 1)  # Still just 1

            # Update with embeddings=True - should trigger
            tree.update_node(node1, "Updated again", "Updated summary again", update_embeddings=True)
            self.assertEqual(mock_submit.call_count, 2)  # Now 2


if __name__ == "__main__":
    unittest.main()
