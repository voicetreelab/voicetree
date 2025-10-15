"""
Integration test that mimics server.py startup and verifies all state is loaded correctly.

This single test verifies the complete loading functionality:
1. Markdown files are loaded into the tree
2. Transcript history is loaded from file
3. Vector embeddings are properly initialized and match markdown files
"""
import os
import tempfile
from pathlib import Path

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import (
    ChunkProcessor,
)


class TestServerStartupLoad:
    """Test that mimics server.py startup and verifies all state loading"""

    @pytest.fixture
    def fixture_dir(self):
        """Path to the real example folder with test fixtures"""
        return Path(__file__).parent.parent / "fixtures" / "real_example_folder"

    def test_server_startup_loads_all_state(self, fixture_dir):
        """
        Test that mimics server.py startup sequence and verifies all state is loaded:
        1. Markdown files from directory
        2. Transcript history from .txt file
        3. Vector embeddings match the loaded markdown files

        NOTE: We use the fixture directory directly without copying to avoid unnecessary I/O
        """
        # Check if fixture has transcript history already
        transcript_file = os.path.join(fixture_dir, "transcript_history.txt")
        has_existing_transcript = os.path.exists(transcript_file)

        try:
            # === MIMIC SERVER.PY STARTUP ===
            # Use fixture directory directly without copying
            decision_tree = MarkdownTree(output_dir=str(fixture_dir))

            # Initialize converter and processor (like server.py does)
            converter = TreeToMarkdownConverter(decision_tree.tree)
            processor = ChunkProcessor(
                decision_tree,
                converter=converter,
                output_dir=str(fixture_dir)
            )

            # === VERIFY STATE 1: MARKDOWN FILES LOADED ===
            assert len(decision_tree.tree) > 0, "Markdown files should be automatically loaded"

            # Verify specific nodes from fixtures exist
            assert 10 in decision_tree.tree, "Node 10 should be loaded"
            assert decision_tree.tree[10].title == "Investigate Vector Loading Status (10)"

            assert 11 in decision_tree.tree, "Node 11 should be loaded"
            assert "Transcript" in decision_tree.tree[11].title

            # Verify relationships are loaded
            node_10 = decision_tree.tree[10]
            assert node_10.parent_id is not None or len(node_10.relationships) > 0, \
                "Relationships should be loaded"

            # Verify next_node_id is set correctly
            max_id = max(decision_tree.tree.keys())
            assert decision_tree.next_node_id > max_id, \
                "next_node_id should be higher than max existing node ID"

            # === VERIFY STATE 2: TRANSCRIPT HISTORY LOADED ===
            # The workflow inside ChunkProcessor should have loaded the transcript history
            workflow = processor.workflow
            loaded_history = workflow.get_transcript_history()

            if has_existing_transcript:
                assert loaded_history != "", "Transcript history should be loaded from file"

            # === VERIFY STATE 3: VECTOR EMBEDDINGS INITIALIZED ===
            # Use actual embedding manager, not mock
            assert decision_tree._embedding_manager is not None, \
                "Embedding manager should be initialized"

            # Verify vectors match markdown files
            # The embedding manager should have vectors for all loaded nodes
            num_nodes = len(decision_tree.tree)
            vector_count = 0

            # Check that embedding manager is properly initialized
            if hasattr(decision_tree._embedding_manager, 'vector_store'):
                # Verify we can search (even if results are empty in test mode)
                search_results = decision_tree.search_similar_nodes("test query", top_k=5)
                assert isinstance(search_results, list), "Search should return a list"

                # Get the real count from ChromaDB
                # First, ensure all nodes are synced to embeddings
                decision_tree._embedding_manager.sync_all_embeddings()

                # Get the actual count from ChromaDB collection
                collection_stats = decision_tree._embedding_manager.get_stats()
                vector_count = collection_stats.get('count', 0)

                # Verify vector count matches node count
                assert vector_count == num_nodes, \
                    f"ChromaDB should have {num_nodes} vectors (one for each node), but has {vector_count}"

            print(f"✅ Loaded {num_nodes} markdown nodes")
            print(f"✅ Transcript history loaded: {len(loaded_history)} chars")
            print(f"✅ Embedding manager initialized with {vector_count} vectors in ChromaDB")

        finally:
            # Clean up only if we created the transcript file
            if not has_existing_transcript and os.path.exists(transcript_file):
                os.remove(transcript_file)

    def test_server_startup_with_persistence(self, fixture_dir):
        """
        Test that new additions persist correctly without unnecessary copying.
        Uses a temp directory for this test to avoid modifying fixtures.
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            # Copy only necessary fixture files once
            import shutil

            # Copy a few sample markdown files
            sample_files = ["10_Investigate_Vector_Loading_Status.md",
                          "11_Identify_and_Modify_Code_for_Transcript_Saving.md"]
            for filename in sample_files:
                src = os.path.join(fixture_dir, filename)
                if os.path.exists(src):
                    shutil.copy2(src, temp_dir)

            # Create initial transcript history
            transcript_file = os.path.join(temp_dir, "transcript_history.txt")
            with open(transcript_file, 'w') as f:
                f.write("Initial transcript content.")

            # === FIRST STARTUP ===
            decision_tree = MarkdownTree(output_dir=temp_dir)
            converter = TreeToMarkdownConverter(decision_tree.tree)
            processor = ChunkProcessor(
                decision_tree,
                converter=converter,
                output_dir=temp_dir
            )

            initial_node_count = len(decision_tree.tree)

            # Add a new node
            new_node_id = decision_tree.create_new_node(
                name="Test Node",
                parent_node_id=10 if 10 in decision_tree.tree else None,
                content="Test content",
                summary="Test summary"
            )

            # Add to transcript history
            processor.workflow._history_manager.append(" New transcript entry.", max_length=10000)

            # === SECOND STARTUP (SIMULATE RESTART) ===
            decision_tree_2 = MarkdownTree(output_dir=temp_dir)
            converter_2 = TreeToMarkdownConverter(decision_tree_2.tree)
            processor_2 = ChunkProcessor(
                decision_tree_2,
                converter=converter_2,
                output_dir=temp_dir
            )

            # Verify persistence
            assert new_node_id in decision_tree_2.tree, \
                "New node should persist after restart"
            assert len(decision_tree_2.tree) == initial_node_count + 1, \
                "Should have one more node after restart"

            # Verify transcript history persisted
            reloaded_history = processor_2.workflow.get_transcript_history()
            assert "Initial transcript content." in reloaded_history
            assert "New transcript entry." in reloaded_history

    def test_server_startup_empty_directory(self):
        """Test server startup with empty directory (fresh start)"""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Initialize with empty directory
            decision_tree = MarkdownTree(output_dir=temp_dir)
            converter = TreeToMarkdownConverter(decision_tree.tree)
            processor = ChunkProcessor(
                decision_tree,
                converter=converter,
                output_dir=temp_dir
            )

            # Should start with empty tree
            assert len(decision_tree.tree) == 0, "Should start with empty tree"
            assert decision_tree.next_node_id == 1, "Should start with node ID 1"

            # Should have empty transcript history
            assert processor.workflow.get_transcript_history() == "", \
                "Should have empty transcript history"

            # Should still have embedding manager
            assert decision_tree._embedding_manager is not None, \
                "Should have embedding manager even with empty directory"