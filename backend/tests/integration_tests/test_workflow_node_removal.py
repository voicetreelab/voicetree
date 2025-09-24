"""
Integration test for node removal within TreeActionDeciderWorkflow pipeline.

Tests that the workflow correctly handles nodes whose markdown files have been deleted,
removing them from the tree during sync operations.
"""

import os
import tempfile
import pytest
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow,
)
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction,
    CreateAction,
)


class MockWorkflowForRemovalTest(TreeActionDeciderWorkflow):
    """Mock workflow that returns predictable actions for testing"""

    def __init__(self, decision_tree):
        super().__init__(decision_tree)
        self.run_count = 0
        self.existing_node_ids = []

    def run_stateful_workflow(self, text: str, transcript_history: str):
        """
        Mock implementation that creates predictable actions and applies them.
        First run: Creates 2 new nodes
        Second run: Appends to the first node (if it exists)
        """
        from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
        from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import WorkflowResult
        from backend.markdown_tree_manager.sync_markdown_to_tree import sync_nodes_from_markdown

        self.run_count += 1

        if self.run_count == 1:
            # First run: Create two nodes
            actions = [
                CreateAction(
                    action="CREATE",
                    parent_node_id=None,
                    new_node_name="Node A",
                    content=f"Content A: {text[:50]}",
                    summary="Summary A",
                    relationship="root"
                ),
                CreateAction(
                    action="CREATE",
                    parent_node_id=None,
                    new_node_name="Node B",
                    content=f"Content B: {text[50:100] if len(text) > 50 else text}",
                    summary="Summary B",
                    relationship="root"
                )
            ]
        else:
            # Second run: First sync (which will remove deleted nodes)
            # Collect nodes that would be modified
            nodes_to_sync = set()
            if self.decision_tree.tree:
                # In a real workflow, we'd sync nodes that are about to be modified
                # Here we sync all nodes to trigger deletion detection
                nodes_to_sync = set(self.decision_tree.tree.keys())

            if nodes_to_sync:
                sync_nodes_from_markdown(self.decision_tree, nodes_to_sync)

            # Now create actions based on current tree state
            if self.decision_tree.tree:
                node_ids = list(self.decision_tree.tree.keys())
                target_id = node_ids[0] if node_ids else None

                if target_id:
                    actions = [
                        AppendAction(
                            action="APPEND",
                            target_node_id=target_id,
                            target_node_name=self.decision_tree.tree[target_id].title,
                            content=f"\\n+++\\nAppended content: {text[:50]}"
                        )
                    ]
                else:
                    # No nodes exist, create a new one
                    actions = [
                        CreateAction(
                            action="CREATE",
                            parent_node_id=None,
                            new_node_name="Node C",
                            content=f"Content C: {text[:50]}",
                            summary="Summary C",
                            relationship="root"
                        )
                    ]
            else:
                # Tree is empty, create a new node
                actions = [
                    CreateAction(
                        action="CREATE",
                        parent_node_id=None,
                        new_node_name="Node C",
                        content=f"Content C: {text[:50]}",
                        summary="Summary C",
                        relationship="root"
                    )
                ]

        # Apply the actions using TreeActionApplier
        tree_action_applier = TreeActionApplier(self.decision_tree)
        modified_nodes = tree_action_applier.apply(actions)

        # Return the workflow result
        return WorkflowResult(
            success=True,
            new_nodes=[a.new_node_name for a in actions if isinstance(a, CreateAction)],
            tree_actions=actions,
            error_message=None
        )


class TestWorkflowNodeRemoval:
    """Test node removal within the TreeActionDeciderWorkflow pipeline"""

    def test_workflow_handles_deleted_markdown_gracefully(self):
        """
        Test that workflow correctly removes nodes with deleted markdown files.

        Scenario:
        1. Run workflow to create nodes A and B
        2. Delete markdown file for node B
        3. Run workflow again - it should:
           - Remove node B during sync
           - Successfully append to node A
           - Complete without errors
        """

        with tempfile.TemporaryDirectory() as temp_dir:
            # Setup
            tree = MarkdownTree(output_dir=temp_dir, embedding_manager=False)
            workflow = MockWorkflowForRemovalTest(tree)

            # Run 1: Create two nodes
            result1 = workflow.run_stateful_workflow(
                text="First run text that will create two nodes with some content",
                transcript_history=""
            )

            assert result1.success
            assert len(tree.tree) == 2, "Should have created 2 nodes"

            # Get node IDs and verify markdown files exist
            node_ids = list(tree.tree.keys())
            node_a_id = node_ids[0]
            node_b_id = node_ids[1]

            node_a = tree.tree[node_a_id]
            node_b = tree.tree[node_b_id]

            markdown_a_path = os.path.join(temp_dir, node_a.filename)
            markdown_b_path = os.path.join(temp_dir, node_b.filename)

            assert os.path.exists(markdown_a_path), "Node A markdown should exist"
            assert os.path.exists(markdown_b_path), "Node B markdown should exist"

            # Delete node B's markdown file
            os.unlink(markdown_b_path)
            assert not os.path.exists(markdown_b_path), "Node B markdown should be deleted"

            # Run 2: Should remove node B and append to node A
            result2 = workflow.run_stateful_workflow(
                text="Second run text that should append to existing node",
                transcript_history=""
            )

            # Verify results
            assert result2.success, "Second workflow run should succeed"

            # Node B should be removed
            assert node_b_id not in tree.tree, "Node B should be removed from tree"

            # Node A should still exist
            assert node_a_id in tree.tree, "Node A should still exist"

            # Node A should have appended content
            node_a_updated = tree.tree[node_a_id]
            assert "Appended content" in node_a_updated.content, \
                "Node A should have appended content"

            # Tree should only have 1 node now
            assert len(tree.tree) == 1, \
                f"Tree should have 1 node after removal, but has {len(tree.tree)}"

            # Markdown file for node A should still exist
            assert os.path.exists(markdown_a_path), \
                "Node A markdown should still exist"

    def test_workflow_handles_all_nodes_deleted(self):
        """
        Test workflow handles case where all markdown files are deleted.

        Scenario:
        1. Run workflow to create nodes
        2. Delete all markdown files
        3. Run workflow again - should remove all nodes and create new ones
        """

        with tempfile.TemporaryDirectory() as temp_dir:
            # Setup
            tree = MarkdownTree(output_dir=temp_dir, embedding_manager=False)
            workflow = MockWorkflowForRemovalTest(tree)

            # Run 1: Create nodes
            result1 = workflow.run_stateful_workflow(
                text="Initial text to create nodes",
                transcript_history=""
            )

            assert result1.success
            initial_node_count = len(tree.tree)
            assert initial_node_count > 0, "Should have created nodes"

            # Delete all markdown files
            for node in tree.tree.values():
                markdown_path = os.path.join(temp_dir, node.filename)
                if os.path.exists(markdown_path):
                    os.unlink(markdown_path)

            # Run 2: Should remove all nodes and create new one
            result2 = workflow.run_stateful_workflow(
                text="Second run after deleting all files",
                transcript_history=""
            )

            assert result2.success, "Workflow should succeed even with all nodes deleted"

            # Should have new nodes (Node C from mock)
            assert len(tree.tree) == 1, "Should have created new node"

            # Verify it's a new node (Node C)
            node = list(tree.tree.values())[0]
            assert "Node C" in node.title or "Content C" in node.content, \
                "Should have created Node C since all nodes were deleted"

    def test_workflow_with_parent_child_removal(self):
        """
        Test that removing a parent node orphans its children correctly.

        Scenario:
        1. Create a parent-child relationship
        2. Delete parent's markdown
        3. Run workflow - parent removed, child becomes orphan
        """

        with tempfile.TemporaryDirectory() as temp_dir:
            # Setup tree with parent-child relationship
            tree = MarkdownTree(output_dir=temp_dir, embedding_manager=False)

            # Create parent
            parent_id = tree.create_new_node(
                name="Parent Node",
                parent_node_id=None,
                content="Parent content",
                summary="Parent summary"
            )

            # Create child
            child_id = tree.create_new_node(
                name="Child Node",
                parent_node_id=parent_id,
                content="Child content",
                summary="Child summary"
            )

            # Verify relationship
            assert tree.tree[child_id].parent_id == parent_id
            assert child_id in tree.tree[parent_id].children

            # Delete parent's markdown
            parent_node = tree.tree[parent_id]
            parent_path = os.path.join(temp_dir, parent_node.filename)
            os.unlink(parent_path)

            # Manually trigger sync to remove deleted nodes
            from backend.markdown_tree_manager.sync_markdown_to_tree import sync_nodes_from_markdown

            # Sync all nodes (which will detect and remove the parent)
            sync_nodes_from_markdown(tree, {parent_id, child_id})

            # Parent should be removed
            assert parent_id not in tree.tree, "Parent should be removed"

            # Child should still exist but as orphan
            assert child_id in tree.tree, "Child should still exist"
            assert tree.tree[child_id].parent_id is None, "Child should be orphaned"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])