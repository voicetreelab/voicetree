"""
Test that stale vectors are properly cleaned up when files are deleted and tree is reloaded.

This tests the fix for the bug where after file removal and directory auto-load,
vectors for deleted nodes remain in ChromaDB.
"""

import os
import shutil
import time
import uuid
from pathlib import Path

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import load_markdown_tree


class TestStaleVectorCleanup:
    """Test that stale vectors are properly removed during sync"""

    @pytest.fixture
    def non_temp_test_dir(self):
        """Create a UNIQUE test directory for each test (for persistent ChromaDB)"""
        # Create unique directory for each test to avoid ChromaDB lock conflicts
        unique_id = str(uuid.uuid4())[:8]
        test_dir = Path(__file__).parent.parent.parent / "fixtures" / f"stale_vector_test_{unique_id}"
        test_dir.mkdir(parents=True, exist_ok=True)

        yield str(test_dir)

        # Cleanup after test
        if test_dir.exists():
            shutil.rmtree(test_dir)

    @pytest.mark.slow
    def test_stale_vectors_removed_after_file_deletion_and_reload(self, non_temp_test_dir):
        """
        Bug scenario (with persistent ChromaDB):
        1. Create tree with nodes 1, 2, 3 -> vectors created for all
        2. Delete markdown files for nodes 2, 3
        3. Reload tree with load_markdown_tree()
        4. Vectors for nodes 2, 3 should be REMOVED
        """
        original_test_mode = os.environ.get('VOICETREE_TEST_MODE')
        os.environ['VOICETREE_TEST_MODE'] = 'false'

        try:
            temp_dir = non_temp_test_dir

            # Session 1: Create tree with 3 nodes
            tree1 = MarkdownTree(output_dir=temp_dir)

            # Clear and use synchronous embedding updates
            if tree1._embedding_manager:
                tree1._embedding_manager.clear_all_embeddings()

            node1_id = tree1.create_new_node(
                "Node One",
                None,
                "Content for node one about apples",
                "Summary one"
            )

            node2_id = tree1.create_new_node(
                "Node Two",
                None,
                "Content for node two about bananas",
                "Summary two"
            )

            node3_id = tree1.create_new_node(
                "Node Three",
                None,
                "Content for node three about oranges",
                "Summary three"
            )

            # Wait for async operations to complete before sync
            time.sleep(0.5)

            # Use synchronous sync to ensure vectors are stored
            tree1._embedding_manager.sync_all_embeddings()

            # Verify all 3 vectors are stored
            stats1 = tree1._embedding_manager.get_stats()
            assert stats1['count'] == 3, f"Expected 3 vectors, got {stats1['count']}"

            # Get the filenames before we lose reference
            node2_filename = tree1.tree[node2_id].filename
            node3_filename = tree1.tree[node3_id].filename

            # Delete markdown files for nodes 2 and 3 externally
            os.remove(os.path.join(temp_dir, node2_filename))
            os.remove(os.path.join(temp_dir, node3_filename))

            # Session 2: Reload tree from markdown directory
            # This should only find node 1's file and should clean up stale vectors
            tree2 = load_markdown_tree(temp_dir)

            # Wait for any async operations
            time.sleep(0.5)

            # Verify only node 1 exists in tree
            assert len(tree2.tree) == 1, f"Expected 1 node in tree, got {len(tree2.tree)}"
            assert node1_id in tree2.tree

            # THE CRITICAL CHECK: Vectors should also be cleaned up
            stats2 = tree2._embedding_manager.get_stats()
            assert stats2['count'] == 1, (
                f"Expected 1 vector after reload, got {stats2['count']}. "
                f"Stale vectors for deleted nodes were not cleaned up!"
            )

        finally:
            if original_test_mode is not None:
                os.environ['VOICETREE_TEST_MODE'] = original_test_mode
            else:
                os.environ.pop('VOICETREE_TEST_MODE', None)

    @pytest.mark.slow
    def test_get_all_node_ids_from_vector_store(self, non_temp_test_dir):
        """Test that we can retrieve all node IDs from the vector store"""
        original_test_mode = os.environ.get('VOICETREE_TEST_MODE')
        os.environ['VOICETREE_TEST_MODE'] = 'false'

        try:
            temp_dir = non_temp_test_dir
            tree = MarkdownTree(output_dir=temp_dir)

            if tree._embedding_manager:
                tree._embedding_manager.clear_all_embeddings()

            # Create some nodes
            node1_id = tree.create_new_node("Node A", None, "Content A", "Summary A")
            node2_id = tree.create_new_node("Node B", None, "Content B", "Summary B")

            # Wait for async operations to complete
            time.sleep(0.5)

            # Use synchronous sync to ensure vectors are stored
            tree._embedding_manager.sync_all_embeddings()

            # Get all node IDs from vector store
            vector_store = tree._embedding_manager.vector_store
            stored_ids = vector_store.get_all_node_ids()

            assert len(stored_ids) == 2
            assert node1_id in stored_ids
            assert node2_id in stored_ids

        finally:
            if original_test_mode is not None:
                os.environ['VOICETREE_TEST_MODE'] = original_test_mode
            else:
                os.environ.pop('VOICETREE_TEST_MODE', None)

    @pytest.mark.slow
    def test_sync_all_embeddings_removes_stale_vectors(self, non_temp_test_dir):
        """Test that sync_all_embeddings removes vectors for nodes no longer in tree"""
        original_test_mode = os.environ.get('VOICETREE_TEST_MODE')
        os.environ['VOICETREE_TEST_MODE'] = 'false'

        try:
            temp_dir = non_temp_test_dir
            tree = MarkdownTree(output_dir=temp_dir)

            if tree._embedding_manager:
                tree._embedding_manager.clear_all_embeddings()

            # Create 3 nodes
            node1_id = tree.create_new_node("Node A", None, "Content A", "Summary A")
            node2_id = tree.create_new_node("Node B", None, "Content B", "Summary B")
            node3_id = tree.create_new_node("Node C", None, "Content C", "Summary C")

            # Wait for async operations to complete before first sync
            time.sleep(0.5)

            # Sync all embeddings
            tree._embedding_manager.sync_all_embeddings()

            # Verify 3 vectors
            assert tree._embedding_manager.get_stats()['count'] == 3

            # Remove nodes 2 and 3 from tree (but vectors remain)
            del tree.tree[node2_id]
            del tree.tree[node3_id]

            # Now sync_all_embeddings should reconcile and remove stale vectors
            tree._embedding_manager.sync_all_embeddings()

            # Wait for any async operations that might have been triggered
            time.sleep(0.5)

            # After reconciliation, should only have 1 vector
            stats = tree._embedding_manager.get_stats()
            stored_ids = tree._embedding_manager.vector_store.get_all_node_ids()

            assert stats['count'] == 1, (
                f"Expected 1 vector after sync, got {stats['count']}. "
                f"Stale vectors were not removed! Stored IDs: {stored_ids}"
            )

            # Verify the correct node remains
            assert node1_id in stored_ids
            assert node2_id not in stored_ids
            assert node3_id not in stored_ids

        finally:
            if original_test_mode is not None:
                os.environ['VOICETREE_TEST_MODE'] = original_test_mode
            else:
                os.environ.pop('VOICETREE_TEST_MODE', None)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
