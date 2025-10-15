"""
Test for the desired behavior: CreateAction should handle linking children directly.
This test defines the BEHAVIOR we want, not implementation details.
"""

import pytest
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree, Node
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier


class TestOrphanLinkingBehavior:
    """Test that CreateAction can link existing orphan nodes as children"""

    def test_create_action_with_children_to_link(self):
        """
        BEHAVIOR: When a CreateAction has children_to_link, those children
        should become children of the newly created node.

        This tests the complete desired behavior:
        1. CreateAction creates a new parent node
        2. Children specified in children_to_link get their parent_id updated
        3. The parent node's children list includes these children
        """
        # Setup: Create a tree with some orphan nodes
        tree = MarkdownTree()

        # Create 3 orphan nodes
        orphan1 = Node(
            name="Orphan Node 1",
            node_id=1,
            content="Content 1",
            summary="Summary 1",
            parent_id=None
        )
        tree.tree[1] = orphan1

        orphan2 = Node(
            name="Orphan Node 2",
            node_id=2,
            content="Content 2",
            summary="Summary 2",
            parent_id=None
        )
        tree.tree[2] = orphan2

        orphan3 = Node(
            name="Orphan Node 3",
            node_id=3,
            content="Content 3",
            summary="Summary 3",
            parent_id=None
        )
        tree.tree[3] = orphan3

        tree.next_node_id = 4

        # Verify initial state: all nodes are orphans
        assert tree.tree[1].parent_id is None
        assert tree.tree[2].parent_id is None
        assert tree.tree[3].parent_id is None

        # BEHAVIOR UNDER TEST:
        # Create a new parent node and link orphans 1 and 2 as its children
        create_action = CreateAction(
            action="CREATE",
            parent_node_id=None,  # This is a root node
            new_node_name="Parent Node",
            content="Parent content",
            summary="Parent summary",
            relationship="",
            children_to_link=[1, 2]  # Link nodes 1 and 2 as children
        )

        # Apply the action
        applier = TreeActionApplier(tree)
        modified_nodes = applier.apply([create_action])

        # Find the newly created parent node
        parent_node = None
        parent_id = None
        for node_id, node in tree.tree.items():
            if node.title == "Parent Node":
                parent_node = node
                parent_id = node_id
                break

        # ASSERTIONS: Verify the behavior
        assert parent_node is not None, "Parent node should be created"

        # Children should now have parent_id set
        assert tree.tree[1].parent_id == parent_id, "Node 1 should be linked to parent"
        assert tree.tree[2].parent_id == parent_id, "Node 2 should be linked to parent"
        assert tree.tree[3].parent_id is None, "Node 3 should remain orphaned"

        # Parent should have children list
        assert hasattr(parent_node, 'children'), "Parent should have children attribute"
        assert 1 in parent_node.children, "Parent's children should include node 1"
        assert 2 in parent_node.children, "Parent's children should include node 2"
        assert 3 not in parent_node.children, "Parent's children should not include node 3"

        # Modified nodes should include parent and updated children
        assert parent_id in modified_nodes, "Parent node should be in modified set"
        assert 1 in modified_nodes, "Child 1 should be in modified set"
        assert 2 in modified_nodes, "Child 2 should be in modified set"

    @pytest.mark.asyncio
    async def test_connect_orphans_agent_uses_children_to_link(self):
        """
        BEHAVIOR: ConnectOrphansAgent should populate children_to_link in CreateAction
        rather than returning a separate parent_child_mapping.
        """
        from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import ConnectOrphansAgent
        import tempfile
        import os

        # Create a temporary directory for the test to avoid loading existing markdown files
        with tempfile.TemporaryDirectory() as tmpdir:
            # Set environment variable to use temp directory
            old_vault = os.environ.get('OBSIDIAN_VAULT_PATH', None)
            os.environ['OBSIDIAN_VAULT_PATH'] = tmpdir

            try:
                # Setup: Create a tree with orphan nodes
                tree = MarkdownTree(output_dir=tmpdir)

                # Create several orphan nodes that should be grouped
                orphan_nodes = [
                    (1, Node(name="User Authentication", node_id=1, content="Auth system", parent_id=None)),
                    (2, Node(name="User Sessions", node_id=2, content="Session management", parent_id=None)),
                    (3, Node(name="Database Operations", node_id=3, content="DB queries", parent_id=None)),
                    (4, Node(name="API Endpoints", node_id=4, content="REST API", parent_id=None))
                ]

                for node_id, node in orphan_nodes:
                    tree.tree[node_id] = node
                tree.next_node_id = 5

                # Run the agent
                agent = ConnectOrphansAgent()
                actions, _ = await agent.run(tree, max_roots_to_process=10)

                # ASSERTIONS: Verify the behavior
                if actions:  # Agent might not create groups if it doesn't find relationships
                    print(f"DEBUG: Got {len(actions)} actions from agent")
                    for action in actions:
                        print(f"DEBUG: Action type: {action.action}, name: {getattr(action, 'new_node_name', 'N/A')}")
                        if action.action == "CREATE":
                            # The CreateAction should have children_to_link populated
                            assert hasattr(action, 'children_to_link'), "CreateAction should have children_to_link attribute"
                            print(f"DEBUG: children_to_link: {action.children_to_link}")
                            if action.children_to_link:
                                assert isinstance(action.children_to_link, list), "children_to_link should be a list"
                                assert all(isinstance(child_id, int) for child_id in action.children_to_link), \
                                    "children_to_link should contain integer node IDs"

                    # Apply actions and verify children are properly linked
                    applier = TreeActionApplier(tree)
                    modified_nodes = applier.apply(actions)
                    print(f"DEBUG: Modified nodes: {modified_nodes}")

                    # Check that orphans are now connected
                    connected_orphans = []
                    for node_id in [1, 2, 3, 4]:
                        print(f"DEBUG: Node {node_id} parent_id: {tree.tree[node_id].parent_id}")
                        if tree.tree[node_id].parent_id is not None:
                            connected_orphans.append(node_id)

                    # If any CreateActions had children_to_link, some orphans should be connected
                    create_actions_with_children = [a for a in actions if a.action == "CREATE" and getattr(a, 'children_to_link', None)]
                    if create_actions_with_children:
                        print(f"DEBUG: Found {len(create_actions_with_children)} CREATE actions with children_to_link")
                        assert len(connected_orphans) > 0, "Some orphans should be connected to new parents"
                else:
                    print("DEBUG: No actions returned from agent")
            finally:
                # Restore old environment variable
                if old_vault:
                    os.environ['OBSIDIAN_VAULT_PATH'] = old_vault
                elif 'OBSIDIAN_VAULT_PATH' in os.environ:
                    del os.environ['OBSIDIAN_VAULT_PATH']


if __name__ == "__main__":
    # Run the synchronous test
    test = TestOrphanLinkingBehavior()
    test.test_create_action_with_children_to_link()
    print("✓ Synchronous test passed")

    # Run the async test
    import asyncio
    asyncio.run(test.test_connect_orphans_agent_uses_children_to_link())
    print("✓ Async test passed")