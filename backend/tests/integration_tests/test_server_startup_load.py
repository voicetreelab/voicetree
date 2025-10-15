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
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import load_markdown_tree
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
        # Save original test mode and set to false to use real ChromaDB
        original_test_mode = os.environ.get('VOICETREE_TEST_MODE')
        os.environ['VOICETREE_TEST_MODE'] = 'false'

        # Check if fixture has transcript history already
        transcript_file = os.path.join(fixture_dir, "transcript_history.txt")
        has_existing_transcript = os.path.exists(transcript_file)

        # === MIMIC SERVER.PY STARTUP ===
        # Use fixture directory directly without copying - load existing markdown files
        decision_tree = load_markdown_tree(str(fixture_dir))

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

        # Get the actual count from ChromaDB collection
        collection_stats = decision_tree._embedding_manager.get_stats()
        vector_count = collection_stats.get('count', 0)

        # Verify vector count matches node count
        assert vector_count == num_nodes, \
            f"ChromaDB should have {num_nodes} vectors (one for each node), but has {vector_count}"

        print(f"✅ Loaded {num_nodes} markdown nodes")
        print(f"✅ Transcript history loaded: {len(loaded_history)} chars")
        print(f"✅ Embedding manager initialized with {vector_count} vectors in ChromaDB")