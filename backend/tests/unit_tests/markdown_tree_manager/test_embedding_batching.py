"""
Test embedding batching behavior in MarkdownTree.
"""

import unittest
from unittest.mock import Mock, MagicMock, patch
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree


class TestEmbeddingBatching(unittest.TestCase):
    """Test that embeddings are batched and not updated on every operation"""

    def test_embedding_updates_are_batched(self):
        """Test that embeddings are batched and not updated until threshold"""
        # Create a mock embedding manager
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()

        # Create tree with mock manager
        tree = MarkdownTree(embedding_manager=mock_manager)
        tree._embedding_batch_size = 3  # Set batch size to 3 for testing

        # Create nodes (should not trigger embedding update yet)
        node1 = tree.create_new_node("Node 1", None, "Content 1", "Summary 1")
        mock_manager.vector_store.add_nodes.assert_not_called()

        node2 = tree.create_new_node("Node 2", None, "Content 2", "Summary 2")
        mock_manager.vector_store.add_nodes.assert_not_called()

        # Third node should trigger batch update
        node3 = tree.create_new_node("Node 3", None, "Content 3", "Summary 3")
        mock_manager.vector_store.add_nodes.assert_called_once()

        # Verify all 3 nodes were updated in batch
        call_args = mock_manager.vector_store.add_nodes.call_args[0][0]
        self.assertEqual(len(call_args), 3)
        self.assertIn(node1, call_args)
        self.assertIn(node2, call_args)
        self.assertIn(node3, call_args)

    def test_flush_embeddings_forces_update(self):
        """Test that flush_embeddings forces pending updates"""
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()

        tree = MarkdownTree(embedding_manager=mock_manager)
        tree._embedding_batch_size = 10  # High threshold

        # Create just 2 nodes (below threshold)
        node1 = tree.create_new_node("Node 1", None, "Content 1", "Summary 1")
        node2 = tree.create_new_node("Node 2", None, "Content 2", "Summary 2")
        mock_manager.vector_store.add_nodes.assert_not_called()

        # Flush should force update
        tree.flush_embeddings()
        mock_manager.vector_store.add_nodes.assert_called_once()

        # Verify both nodes were updated
        call_args = mock_manager.vector_store.add_nodes.call_args[0][0]
        self.assertEqual(len(call_args), 2)

    def test_search_flushes_pending_updates(self):
        """Test that search operations flush pending updates first"""
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()
        mock_manager.search = Mock(return_value=[])

        tree = MarkdownTree(embedding_manager=mock_manager)
        tree._embedding_batch_size = 10

        # Create a node (won't trigger update)
        node1 = tree.create_new_node("Node 1", None, "Content 1", "Summary 1")
        mock_manager.vector_store.add_nodes.assert_not_called()

        # Search should flush pending updates first
        tree.search_similar_nodes("test query")

        # Verify embeddings were flushed before search
        mock_manager.vector_store.add_nodes.assert_called_once()
        mock_manager.search.assert_called_once()

    def test_update_with_embeddings_false_skips_batching(self):
        """Test that update_node with update_embeddings=False doesn't add to batch"""
        mock_manager = Mock()
        mock_manager.enabled = True
        mock_manager.vector_store = Mock()
        mock_manager.vector_store.add_nodes = Mock()

        tree = MarkdownTree(embedding_manager=mock_manager)
        tree._embedding_batch_size = 2

        # Create a node
        node1 = tree.create_new_node("Node 1", None, "Content 1", "Summary 1")

        # Update with embeddings=False (e.g., from sync)
        tree.update_node(node1, "Updated content", "Updated summary", update_embeddings=False)

        # Create another node - this should only have 1 pending update
        node2 = tree.create_new_node("Node 2", None, "Content 2", "Summary 2")

        # Should trigger batch with 2 nodes (node1 from create, node2 from create)
        # but NOT the update
        mock_manager.vector_store.add_nodes.assert_called_once()
        call_args = mock_manager.vector_store.add_nodes.call_args[0][0]
        self.assertEqual(len(call_args), 2)


if __name__ == "__main__":
    unittest.main()