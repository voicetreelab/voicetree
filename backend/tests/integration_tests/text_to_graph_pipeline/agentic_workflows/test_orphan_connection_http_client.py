"""
End-to-end test for the Orphan Connection Agent HTTP Client.
Tests the full HTTP path including tree.to_dict() serialization.
"""

import asyncio
import logging
import os
from pathlib import Path

import pytest

from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree, Node
from cloud_functions.agentic_workflows.http_client import ConnectOrphansAgentHTTPClient

logging.basicConfig(level=logging.INFO)


class TestOrphanConnectionHTTPClient:
    """Test the HTTP client path for orphan connection"""

    def create_tree_with_orphans(self) -> MarkdownTree:
        """Create a test tree with multiple orphan nodes that should be grouped"""
        tree = MarkdownTree()

        # Component 1: Authentication system (has children, so it's a tree)
        auth_root = Node(
            name="User Authentication",
            node_id=1,
            content="User authentication system overview",
            summary="Handles user login and authentication",
            parent_id=None
        )
        tree.tree[1] = auth_root

        password_node = Node(
            name="Password Management",
            node_id=2,
            content="Password hashing and storage with bcrypt",
            summary="Secure password handling",
            parent_id=1
        )
        tree.tree[2] = password_node
        auth_root.children.append(2)
        auth_root.relationships[2] = "is_parent_of"

        # Component 2: Session handling (orphan - related to auth)
        session_root = Node(
            name="Session Handling",
            node_id=3,
            content="User session management with JWT tokens",
            summary="Manages active user sessions",
            parent_id=None
        )
        tree.tree[3] = session_root

        # Component 3: Token Management (orphan - related to auth and sessions)
        token_root = Node(
            name="JWT Token Management",
            node_id=4,
            content="Creating and validating JWT tokens for authentication",
            summary="Handles JSON Web Token operations",
            parent_id=None
        )
        tree.tree[4] = token_root

        # Component 4: Database operations (has children)
        db_root = Node(
            name="Database Queries",
            node_id=5,
            content="Database query optimization for user data",
            summary="Optimizing SQL queries for performance",
            parent_id=None
        )
        tree.tree[5] = db_root

        index_node = Node(
            name="Index Management",
            node_id=6,
            content="Database index strategies for fast lookups",
            summary="Managing database indexes",
            parent_id=5
        )
        tree.tree[6] = index_node
        db_root.children.append(6)
        db_root.relationships[6] = "is_parent_of"

        # Component 5: SQL optimization (orphan - related to DB)
        sql_root = Node(
            name="SQL Query Optimization",
            node_id=7,
            content="Query performance tuning and EXPLAIN analysis",
            summary="Techniques for SQL query optimization",
            parent_id=None
        )
        tree.tree[7] = sql_root

        tree.next_node_id = 8
        tree.roots = [1, 3, 4, 5, 7]  # 5 root nodes

        return tree

    @pytest.mark.asyncio
    async def test_http_client_serialization_and_call(self):
        """Test that the HTTP client can serialize the tree with to_dict() and call the cloud function"""
        tree = self.create_tree_with_orphans()

        print("\n=== Testing HTTP Client with to_dict() ===")
        print(f"Tree has {len(tree.tree)} nodes")
        print(f"Tree has {len(tree.roots)} root nodes (orphans)")

        # Verify tree.to_dict() works
        print("\n=== Testing tree.to_dict() ===")
        try:
            tree_dict = tree.to_dict()
            print(f"✅ tree.to_dict() succeeded")
            print(f"   Serialized {len(tree_dict['tree'])} nodes")

            # Verify the structure
            assert "tree" in tree_dict, "tree_dict should have 'tree' key"
            assert len(tree_dict["tree"]) == len(tree.tree), "All nodes should be serialized"

            # Verify node structure
            first_node = tree_dict["tree"]["1"]
            assert "id" in first_node, "Node should have 'id' field"
            assert "title" in first_node, "Node should have 'title' field"
            assert "content" in first_node, "Node should have 'content' field"
            assert "summary" in first_node, "Node should have 'summary' field"
            assert "parent_id" in first_node, "Node should have 'parent_id' field"
            assert "children" in first_node, "Node should have 'children' field"
            assert "relationships" in first_node, "Node should have 'relationships' field"

        except AttributeError as e:
            pytest.fail(f"tree.to_dict() failed with AttributeError: {e}")

        # Get the cloud function URL from environment
        orphan_url = os.getenv("ORPHAN_AGENT_URL")

        if not orphan_url:
            print("\n⚠️  ORPHAN_AGENT_URL not set - skipping HTTP call test")
            print("   To test the full HTTP path, set ORPHAN_AGENT_URL environment variable")
            pytest.skip("ORPHAN_AGENT_URL not set - serialization test passed")
            return

        print(f"\n=== Testing HTTP Call to Cloud Function ===")
        print(f"URL: {orphan_url}")

        # Create HTTP client
        http_client = ConnectOrphansAgentHTTPClient(orphan_url)

        # Test the HTTP client call (this will call tree.to_dict() internally)
        try:
            actions, parent_child_mapping = await http_client.run(
                tree=tree,
                max_roots_to_process=10
            )

            print(f"\n✅ HTTP client call succeeded")
            print(f"   Returned {len(actions)} actions")
            print(f"   Parent-child mapping: {parent_child_mapping}")

            if actions:
                print("\n=== Actions Created ===")
                for action in actions:
                    print(f"  - CREATE: {action.new_node_name}")
                    print(f"    Summary: {action.summary[:100]}...")
                    if hasattr(action, 'children_to_link') and action.children_to_link:
                        print(f"    Children to link: {action.children_to_link}")
            else:
                print("   (No actions - LLM may not have found good groupings)")

            # Verify the response structure
            assert isinstance(actions, list), "Actions should be a list"
            assert isinstance(parent_child_mapping, dict), "Parent-child mapping should be a dict"

        except Exception as e:
            pytest.fail(f"HTTP client call failed: {e}")

    def _deserialize_node(self, node_dict: dict) -> Node:
        """Deserialize a node dictionary to a Node object (copy of cloud function logic)"""
        node = Node(
            name=node_dict["title"],
            node_id=node_dict["id"],
            content=node_dict["content"],
            summary=node_dict.get("summary", ""),
            parent_id=node_dict.get("parent_id")
        )
        node.children = node_dict.get("children", [])
        node.relationships = node_dict.get("relationships", {})
        return node

    def _reconstruct_tree(self, tree_dict: dict) -> MarkdownTree:
        """Reconstruct a MarkdownTree from a serialized dictionary (copy of cloud function logic)"""
        tree = MarkdownTree()

        # Deserialize nodes
        for node_id_str, node_dict in tree_dict.get("tree", {}).items():
            node_id = int(node_id_str)
            tree.tree[node_id] = self._deserialize_node(node_dict)

        # Store roots
        tree.roots = [
            node_id for node_id, node in tree.tree.items()
            if node.parent_id is None
        ]

        return tree

    @pytest.mark.asyncio
    async def test_http_client_round_trip(self):
        """Test that data survives serialization -> HTTP -> deserialization round trip"""
        tree = self.create_tree_with_orphans()

        # Serialize
        tree_dict = tree.to_dict()

        # Verify we can reconstruct (this simulates what the cloud function does)
        reconstructed_tree = self._reconstruct_tree(tree_dict)

        print("\n=== Round-trip Test ===")
        print(f"Original tree: {len(tree.tree)} nodes")
        print(f"Reconstructed tree: {len(reconstructed_tree.tree)} nodes")

        # Verify all nodes were preserved
        assert len(reconstructed_tree.tree) == len(tree.tree), "Node count should match"

        # Verify node data was preserved
        for node_id in tree.tree:
            original = tree.tree[node_id]
            reconstructed = reconstructed_tree.tree[node_id]

            assert reconstructed.id == original.id, f"Node {node_id} ID should match"
            assert reconstructed.title == original.title, f"Node {node_id} title should match"
            assert reconstructed.content == original.content, f"Node {node_id} content should match"
            assert reconstructed.summary == original.summary, f"Node {node_id} summary should match"
            assert reconstructed.parent_id == original.parent_id, f"Node {node_id} parent_id should match"
            assert reconstructed.children == original.children, f"Node {node_id} children should match"

        print("✅ All node data preserved in round-trip")


    @pytest.mark.asyncio
    async def test_http_client_end_to_end_with_cloud_function(self):
        """
        Full e2e test: multiple orphans should be connected by new parent nodes via HTTP client

        This test verifies the FULL behavior spec:
        1. Start with multiple orphan nodes
        2. Call HTTP client (which uses to_dict())
        3. Verify orphans are connected to new parent nodes
        """
        tree = self.create_tree_with_orphans()

        print("\n=== E2E Test: Orphan Connection via HTTP Client ===")

        # Count initial orphans
        initial_orphans = [
            node_id for node_id, node in tree.tree.items()
            if node.parent_id is None
        ]
        print(f"Initial orphan count: {len(initial_orphans)}")
        print(f"Orphan IDs: {initial_orphans}")

        # Get the cloud function URL from environment
        orphan_url = os.getenv("ORPHAN_AGENT_URL")

        if not orphan_url:
            print("\n⚠️  ORPHAN_AGENT_URL not set - skipping full e2e test")
            print("   To test the full HTTP path, set ORPHAN_AGENT_URL environment variable")
            pytest.skip("ORPHAN_AGENT_URL not set")
            return

        print(f"\n=== Calling Cloud Function ===")
        print(f"URL: {orphan_url}")

        # Create HTTP client
        http_client = ConnectOrphansAgentHTTPClient(orphan_url)

        # Call the HTTP client (this will use to_dict() internally)
        actions, parent_child_mapping = await http_client.run(
            tree=tree,
            max_roots_to_process=10
        )

        print(f"\n=== HTTP Client Results ===")
        print(f"Actions returned: {len(actions)}")
        print(f"Parent-child mapping: {parent_child_mapping}")

        # Debug: Check if children_to_link is populated
        for i, action in enumerate(actions):
            print(f"\nAction {i+1}:")
            print(f"  new_node_name: {action.new_node_name}")
            print(f"  children_to_link: {action.children_to_link}")

        # Apply the actions to the tree
        if actions:
            from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier

            applier = TreeActionApplier(tree)
            modified_nodes = applier.apply(actions)

            print(f"\n=== After Applying Actions ===")
            print(f"Modified/created {len(modified_nodes)} nodes")

            # Count final orphans
            final_orphans = [
                node_id for node_id, node in tree.tree.items()
                if node.parent_id is None
            ]
            print(f"Final orphan count: {len(final_orphans)}")

            # Find new parent nodes
            new_parent_nodes = []
            for node_id in modified_nodes:
                if node_id in tree.tree:
                    node = tree.tree[node_id]
                    if node.parent_id is None and any(
                        other.parent_id == node_id for other in tree.tree.values()
                    ):
                        children = [n for n in tree.tree.values() if n.parent_id == node_id]
                        new_parent_nodes.append((node, children))

            print(f"\n=== New Parent Nodes Created ===")
            for parent, children in new_parent_nodes:
                print(f"\nParent: {parent.title}")
                print(f"  Children ({len(children)}):")
                for child in children:
                    print(f"    - {child.title}")

            # ASSERTIONS - verify the behavior spec
            assert len(actions) > 0, "Should create parent node actions for orphan groupings"
            assert len(final_orphans) < len(initial_orphans), \
                f"Orphan count should decrease: was {len(initial_orphans)}, now {len(final_orphans)}"
            assert len(new_parent_nodes) > 0, "Should create at least one new parent node"

            # Verify each parent has multiple children
            for parent, children in new_parent_nodes:
                assert len(children) >= 2, \
                    f"Parent '{parent.title}' should have at least 2 children, has {len(children)}"

            orphans_connected = len(initial_orphans) - len(final_orphans)
            print(f"\n✅ Successfully connected {orphans_connected} orphan nodes to {len(new_parent_nodes)} new parent(s)")

        else:
            pytest.fail("No actions returned - LLM should have found groupings for related orphans")


if __name__ == "__main__":
    async def main():
        """Run the tests manually"""
        test = TestOrphanConnectionHTTPClient()

        print("=" * 60)
        print("Testing HTTP Client Serialization and Call...")
        print("=" * 60)
        await test.test_http_client_serialization_and_call()

        print("\n" + "=" * 60)
        print("Testing Round-trip Serialization...")
        print("=" * 60)
        await test.test_http_client_round_trip()

        print("\n" + "=" * 60)
        print("Testing Full E2E with Cloud Function...")
        print("=" * 60)
        await test.test_http_client_end_to_end_with_cloud_function()

    asyncio.run(main())
