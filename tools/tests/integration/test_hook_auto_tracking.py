#!/usr/bin/env python3
"""
Integration test for the new hook auto-tracking functionality.
Tests that agents don't get notified about files they create themselves.
"""

import tempfile
import sys
from pathlib import Path
import pytest

# Add tools to path for testing hook functions
TOOLS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(TOOLS_DIR / "hooks"))

from tree_update_reminder import mark_file_as_seen_by_agent, get_new_nodes


class TestHookAutoTracking:
    """Test the auto-tracking feature added to prevent self-notifications."""

    @pytest.fixture
    def temp_vault_and_state(self):
        """Create temporary vault and state directories."""
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)

            # Create vault with sample files
            vault_dir = workspace / "vault"
            vault_dir.mkdir()

            # Create state directory
            state_dir = workspace / "state"
            state_dir.mkdir()

            # Create sample markdown files
            (vault_dir / "existing_node.md").write_text("Existing content")

            yield {
                'vault_dir': vault_dir,
                'state_dir': state_dir,
                'workspace': workspace
            }

    def test_mark_file_as_seen_prevents_detection(self, temp_vault_and_state):
        """Test that marking a file as seen prevents it from being detected as new."""
        vault_dir = temp_vault_and_state['vault_dir']

        # Create a new file that simulates agent-created content
        new_file = vault_dir / "agent_created_node.md"
        new_file.write_text("Agent created this file")

        # Mock the get_agent_state_file to use our temp directory
        import tree_update_reminder
        original_get_state = tree_update_reminder.get_agent_state_file

        def mock_get_state(agent_name):
            return temp_vault_and_state['state_dir'] / f"seen_nodes_{agent_name}.csv"

        tree_update_reminder.get_agent_state_file = mock_get_state

        try:
            # Before marking as seen, it should be detected as new
            new_nodes_before = get_new_nodes(str(vault_dir), "Alice", save_state=False)
            assert "agent_created_node.md" in new_nodes_before

            # Mark the file as seen by Alice
            mark_file_as_seen_by_agent(str(vault_dir), str(new_file), "Alice")

            # After marking as seen, it should not be detected as new for Alice
            new_nodes_after = get_new_nodes(str(vault_dir), "Alice", save_state=False)
            assert "agent_created_node.md" not in new_nodes_after

            # But it should still be detected as new for Bob
            new_nodes_bob = get_new_nodes(str(vault_dir), "Bob", save_state=False)
            assert "agent_created_node.md" in new_nodes_bob

        finally:
            # Restore original function
            tree_update_reminder.get_agent_state_file = original_get_state

    def test_auto_tracking_integration(self, temp_vault_and_state):
        """Test the integration of auto-tracking with add_new_node workflow."""
        vault_dir = temp_vault_and_state['vault_dir']

        # Import the add_new_node functionality to test integration
        sys.path.insert(0, str(TOOLS_DIR))
        from add_new_node import addNewNode

        # Create a parent node
        parent_node = vault_dir / "Parent_Node.md"
        parent_node.write_text("""---
node_id: 1
title: Parent Node (1)
color: blue
---
Parent content.

-----------------
_Links:_
""")

        # Mock the vault directory resolution in add_new_node
        import add_new_node
        original_vault_resolution = None

        # Temporarily patch the vault directory resolution
        # Note: This is a simplified test - in practice the integration happens
        # through environment setup, but we're testing the core logic

        # The auto-tracking should happen when addNewNode is called
        # For this test, we'll verify the mechanism works by simulating the call

        # Create a new node (simulating what add_new_node does)
        new_node_file = vault_dir / "1_1_Test_New_Node.md"
        new_node_file.write_text("""---
node_id: 1_1
title: Test New Node (1_1)
color: blue
agent_name: Alice
---
New node content.

-----------------
_Links:_
Parent:
- tests [[Parent_Node.md]]
""")

        # Simulate the auto-tracking call that happens in add_new_node
        import tree_update_reminder
        original_get_state = tree_update_reminder.get_agent_state_file

        def mock_get_state(agent_name):
            return temp_vault_and_state['state_dir'] / f"seen_nodes_{agent_name}.csv"

        tree_update_reminder.get_agent_state_file = mock_get_state

        try:
            # This simulates the auto-tracking call in add_new_node.py
            mark_file_as_seen_by_agent(str(vault_dir), str(new_node_file), "Alice")

            # Verify Alice doesn't see her own file as new
            alice_new_nodes = get_new_nodes(str(vault_dir), "Alice", save_state=False)
            assert "1_1_Test_New_Node.md" not in alice_new_nodes

            # Verify Bob still sees Alice's file as new
            bob_new_nodes = get_new_nodes(str(vault_dir), "Bob", save_state=False)
            assert "1_1_Test_New_Node.md" in bob_new_nodes

        finally:
            tree_update_reminder.get_agent_state_file = original_get_state

    def test_state_file_creation_and_persistence(self, temp_vault_and_state):
        """Test that state files are created and persist correctly."""
        vault_dir = temp_vault_and_state['vault_dir']
        state_dir = temp_vault_and_state['state_dir']

        # Create test files
        test_file1 = vault_dir / "test1.md"
        test_file2 = vault_dir / "test2.md"
        test_file1.write_text("Test 1")
        test_file2.write_text("Test 2")

        import tree_update_reminder
        original_get_state = tree_update_reminder.get_agent_state_file

        def mock_get_state(agent_name):
            return state_dir / f"seen_nodes_{agent_name}.csv"

        tree_update_reminder.get_agent_state_file = mock_get_state

        try:
            # Mark files as seen by different agents
            mark_file_as_seen_by_agent(str(vault_dir), str(test_file1), "Alice")
            mark_file_as_seen_by_agent(str(vault_dir), str(test_file2), "Bob")

            # Verify state files were created
            alice_state = state_dir / "seen_nodes_Alice.csv"
            bob_state = state_dir / "seen_nodes_Bob.csv"

            assert alice_state.exists(), "Alice's state file should be created"
            assert bob_state.exists(), "Bob's state file should be created"

            # Verify content separation
            alice_content = alice_state.read_text()
            bob_content = bob_state.read_text()

            assert "test1.md" in alice_content
            assert "test1.md" not in bob_content
            assert "test2.md" in bob_content
            assert "test2.md" not in alice_content

        finally:
            tree_update_reminder.get_agent_state_file = original_get_state


if __name__ == "__main__":
    pytest.main([__file__, "-v"])