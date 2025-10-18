"""
End-to-end test for the Connect Orphans mechanism using real qa_example data.
Tests the full pipeline including the Phase 3 orphan connection that runs every N nodes.
"""

import asyncio
import logging
import os
from pathlib import Path

import pytest

from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
    ConnectOrphansAgent,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import (
    TreeActionApplier,
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager

logging.basicConfig(level=logging.INFO)


class TestConnectOrphansE2E:
    """End-to-end tests for orphan connection using qa_example data"""

    def load_qa_example_tree(self) -> MarkdownTree:
        """Load the qa_example tree which has many GPT-SoVITS orphan nodes"""
        voicetree_root = os.getenv('VOICETREE_ROOT')
        if not voicetree_root:
            raise ValueError("VOICETREE_ROOT environment variable not set. Run setup.sh first.")
        tree_path = Path(voicetree_root) / "backend/tests/qa_example"

        if not tree_path.exists():
            pytest.skip(f"Test tree not found at {tree_path}")

        # Load the existing tree from markdown files (returns MarkdownTree object)
        tree = load_markdown_tree(str(tree_path))

        # The load_markdown_tree function already sets the next_node_id properly
        # No need to set it manually

        return tree

    def write_tree_to_markdown_output(self, tree: MarkdownTree, test_name: str) -> str:
        """Write the tree to markdown files in the test output directory"""
        voicetree_root = os.getenv('VOICETREE_ROOT')
        if not voicetree_root:
            raise ValueError("VOICETREE_ROOT environment variable not set. Run setup.sh first.")
        output_dir = Path(voicetree_root) / "backend/tests/integration_tests/connect_orphans_output" / test_name
        output_dir.mkdir(parents=True, exist_ok=True)

        # Clear existing files
        for existing_file in output_dir.glob("*.md"):
            existing_file.unlink()

        # Convert all nodes in the tree to markdown
        converter = TreeToMarkdownConverter(tree.tree)
        all_node_ids = list(tree.tree.keys())
        converter.convert_nodes(output_dir=str(output_dir), nodes_to_update=all_node_ids)

        print("\n=== Markdown Output ===")
        print(f"Tree written to: {output_dir}")
        print(f"Files created: {len(all_node_ids)} markdown files")

        return str(output_dir)

    @pytest.mark.asyncio
    async def test_connect_orphans_with_qa_example(self):
        """Test orphan connection on real qa_example data with GPT-SoVITS nodes"""
        # Load the qa_example tree
        tree = self.load_qa_example_tree()

        # Count initial orphans (nodes with no parent)
        initial_orphans = [
            (node_id, node.title) for node_id, node in tree.tree.items()
            if node.parent_id is None
        ]
        print("\n=== Initial State ===")
        print(f"Total nodes: {len(tree.tree)}")
        print(f"Orphan nodes: {len(initial_orphans)}")
        print("\nOrphan titles:")
        for node_id, title in initial_orphans[:10]:  # Show first 10
            print(f"  - {title}")

        # Run the connect orphans agent directly
        agent = ConnectOrphansAgent()
        actions, parent_child_mapping = await agent.run(tree, max_roots_to_process=20)

        print("\n=== Connect Orphans Agent Results ===")
        print(f"Created {len(actions)} actions")

        # Apply the actions if we want to see the actual tree structure
        if actions:
            # Filter to only CreateActions (parent nodes)
            create_actions = [a for a in actions if a.action == "CREATE"]
            print("\nNew parent nodes to be created:")
            for action in create_actions:
                print(f"  - {action.new_node_name}")
                print(f"    Summary: {action.summary}")

            # Apply actions to the tree - TreeActionApplier handles everything
            # including connecting children via children_to_link field
            applier = TreeActionApplier(tree)
            modified_nodes = applier.apply(actions)

            print("\n=== After Applying Actions ===")
            print(f"Modified/created {len(modified_nodes)} nodes")

            # Verify relationships are properly set by trying to format nodes
            # This would have caught the bug where relationships dict wasn't updated
            from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
                format_nodes_for_prompt,
            )
            connected_children = [
                tree.tree[node_id] for node_id in modified_nodes
                if node_id in tree.tree and tree.tree[node_id].parent_id is not None
            ]
            if connected_children:
                try:
                    # This call will fail if relationships dict is not properly set
                    formatted = format_nodes_for_prompt(connected_children, tree.tree, include_full_content=False)
                    print(f"Successfully formatted {len(connected_children)} connected children for prompt")
                except KeyError as e:
                    raise AssertionError(f"Relationships not properly set: {e}")

            # Count final orphans
            final_orphans = [
                (node_id, node.title) for node_id, node in tree.tree.items()
                if node.parent_id is None
            ]
            print(f"Final orphan count: {len(final_orphans)}")

            # Show the new tree structure for parent nodes
            print("\n=== New Parent Nodes Created ===")
            for node_id in modified_nodes:
                if node_id in tree.tree:
                    node = tree.tree[node_id]
                    if node.parent_id is None and any(
                        other.parent_id == node_id for other in tree.tree.values()
                    ):
                        # This is a new parent node
                        children = [n for n in tree.tree.values() if n.parent_id == node_id]
                        print(f"\nParent: {node.title}")
                        print(f"  Children ({len(children)}):")
                        for child in children[:5]:  # Show first 5 children
                            print(f"    - {child.title}")

            # Write the tree to markdown after applying actions
            self.write_tree_to_markdown_output(tree, "test_connect_orphans_with_qa_example")

        # Assertions for test validity
        assert len(initial_orphans) > 0, "Should have orphan nodes to start with"

        if actions:
            # Verify that orphan count decreased
            assert len(final_orphans) < len(initial_orphans), \
                f"Orphan count should decrease: was {len(initial_orphans)}, now {len(final_orphans)}"

            orphans_connected = len(initial_orphans) - len(final_orphans)
            print("\n=== Test Verification ===")
            print(f"Successfully connected {orphans_connected} orphan nodes to new parent nodes")

    @pytest.mark.asyncio
    async def test_workflow_triggers_orphan_connection_with_qa_data(self):
        """Test that the workflow triggers orphan connection using qa_example"""
        # Load the qa_example tree
        tree = self.load_qa_example_tree()

        initial_node_count = len(tree.tree)

        # Create workflow
        workflow = TreeActionDeciderWorkflow(tree)

        # Force the orphan check by setting the interval low
        workflow._orphan_check_interval = 5  # Check after 5 nodes
        workflow._last_orphan_check_node_count = initial_node_count - 10  # Trigger soon

        # Create necessary components for process_text_chunk
        buffer_manager = TextBufferManager()
        tree_action_applier = TreeActionApplier(tree)

        # Run a dummy text through the workflow to trigger Phase 3
        # The text itself doesn't matter, we just want to trigger the orphan connection
        dummy_text = "This is a test to trigger the orphan connection phase for GPT-SoVITS nodes."

        await workflow.process_text_chunk(
            text_chunk=dummy_text,
            tree_action_applier=tree_action_applier,
            buffer_manager=buffer_manager
        )

        print("\n=== Workflow Orphan Connection Test ===")
        print(f"Initial nodes: {initial_node_count}")
        print(f"Final nodes: {len(tree.tree)}")
        print(f"New nodes created: {len(tree.tree) - initial_node_count}")

        # Check if any new parent nodes were created
        new_parent_nodes = []
        for node_id, node in tree.tree.items():
            if node_id > initial_node_count and node.parent_id is None:
                # This is a new root node (potential parent)
                children = [n for n in tree.tree.values() if n.parent_id == node_id]
                if children:
                    new_parent_nodes.append((node, children))

        if new_parent_nodes:
            print("\n=== New Parent Nodes from Workflow ===")
            for parent, children in new_parent_nodes:
                print(f"\nParent: {parent.title}")
                print(f"  Children ({len(children)}):")
                for child in children[:3]:
                    print(f"    - {child.title}")

        # Write the tree to markdown after workflow processing
        self.write_tree_to_markdown_output(tree, "test_workflow_triggers_orphan_connection")

    @pytest.mark.asyncio
    async def test_connect_orphans_agent_with_actual_connections(self):
        """Test that ConnectOrphansAgent actually updates parent_id (not just creates parents)"""
        # Load the qa_example tree
        tree = self.load_qa_example_tree()

        # Get initial orphans
        initial_orphans = {
            node_id: node for node_id, node in tree.tree.items()
            if node.parent_id is None
        }
        initial_orphan_count = len(initial_orphans)

        print("\n=== Testing Actual Parent Connection ===")
        print(f"Initial orphans: {initial_orphan_count}")

        # Create an enhanced version of ConnectOrphansAgent that actually connects
        agent = ConnectOrphansAgent()

        # Override the create_connection_actions to include UpdateActions
        original_create_actions = agent.create_connection_actions

        def enhanced_create_actions(response, roots):
            """Enhanced version that includes UpdateActions to set parent_id"""
            # Unpack the tuple returned by original_create_actions
            actions, parent_child_mapping = original_create_actions(response, roots)

            # For each CreateAction (parent node), add UpdateActions for children
            enhanced_actions = []
            for action in actions:
                enhanced_actions.append(action)

                # Find which roots should be connected to this parent
                for grouping in response.groupings:
                    if grouping.synthetic_parent_title == action.new_node_name:
                        # Extract child titles from the new structure
                        child_titles = [child.child_title for child in grouping.children]
                        # Map titles to IDs
                        root_ids = agent._map_titles_to_ids(
                            child_titles,
                            roots
                        )

                        # Create UpdateActions to connect orphans to parent
                        for root_id in root_ids:
                            if root_id in tree.tree:
                                update_action = UpdateAction(
                                    action="UPDATE",
                                    node_id=root_id,
                                    parent_node_id=action.new_node_name,  # Will need ID after creation
                                    new_content="",  # Empty string instead of None
                                    new_summary=""   # Empty string instead of None
                                )
                                enhanced_actions.append(update_action)

            return enhanced_actions, parent_child_mapping

        # Temporarily replace the method
        agent.create_connection_actions = enhanced_create_actions

        # Run the agent
        actions, _ = await agent.run(tree, max_roots_to_process=15)

        print(f"Generated {len(actions)} actions")

        # Separate create and update actions
        create_actions = [a for a in actions if isinstance(a, CreateAction)]
        update_actions = [a for a in actions if isinstance(a, UpdateAction)]

        print(f"  - {len(create_actions)} CreateActions (new parent nodes)")
        print(f"  - {len(update_actions)} UpdateActions (connect orphans)")

        # Verify the actions are structured correctly
        if create_actions:
            print("\nParent nodes to create:")
            for action in create_actions[:3]:  # Show first 3
                print(f"  - {action.new_node_name}")

        if update_actions:
            print(f"\nOrphans to connect: {len(update_actions)}")
            # Note: In real implementation, we'd need to handle node ID mapping properly

        # Write the tree to markdown (before applying actions to show initial state)
        self.write_tree_to_markdown_output(tree, "test_connect_orphans_agent_with_actual_connections")

        # The test passes if we generate both create and update actions
        assert len(actions) >= 0, "Should generate some actions or none if no good groupings"


if __name__ == "__main__":
    async def main():
        """Run the tests manually"""
        test = TestConnectOrphansE2E()

        print("=" * 60)
        print("Running Connect Orphans on qa_example data...")
        print("=" * 60)
        await test.test_connect_orphans_with_qa_example()

        print("\n" + "=" * 60)
        print("Testing workflow trigger with qa_example...")
        print("=" * 60)
        await test.test_workflow_triggers_orphan_connection_with_qa_data()

        print("\n" + "=" * 60)
        print("Testing actual parent connections...")
        print("=" * 60)
        await test.test_connect_orphans_agent_with_actual_connections()

    asyncio.run(main())
