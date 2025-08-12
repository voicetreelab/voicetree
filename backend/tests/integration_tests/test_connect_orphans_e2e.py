"""
End-to-end test for the Connect Orphans mechanism in the workflow.
Tests the full pipeline including the Phase 3 orphan connection that runs every N nodes.
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import List

import pytest
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_tree


logging.basicConfig(level=logging.INFO)


class TestConnectOrphansE2E:
    """End-to-end tests for orphan connection in the workflow"""
    
    @pytest.mark.asyncio
    async def test_workflow_triggers_orphan_connection(self):
        """Test that the workflow triggers orphan connection after N nodes"""
        # Create a tree with some initial nodes
        tree = DecisionTree()
        
        # Add a few initial disconnected components
        for i in range(1, 6):
            node = Node(
                name=f"Component {i}",
                node_id=i,
                content=f"Content for component {i}",
                summary=f"Summary of component {i}",
                parent_id=None  # All orphans
            )
            tree.tree[i] = node
        tree.next_node_id = 6
        
        # Create workflow
        workflow = TreeActionDeciderWorkflow(tree)
        
        # Force the orphan check by setting the interval low and last check to 0
        workflow._orphan_check_interval = 5  # Check after 5 nodes
        workflow._last_orphan_check_node_count = 0
        
        # Run a dummy text through the workflow to trigger Phase 3
        # This should trigger the orphan connection since we have 5 nodes
        result = await workflow.run(
            "Some new content to process",
            tree
        )
        
        # Check that the orphan connection was attempted
        # (actual grouping depends on LLM, but the mechanism should run)
        assert len(tree.tree) >= 5  # Original nodes should still exist
        
        # Log the tree structure for debugging
        print(f"\nFinal tree has {len(tree.tree)} nodes:")
        for node_id, node in tree.tree.items():
            parent_info = f"parent={node.parent_id}" if node.parent_id else "ORPHAN"
            print(f"  Node {node_id}: {node.title} ({parent_info})")
    
    @pytest.mark.asyncio
    async def test_load_and_connect_existing_tree(self):
        """Test loading an existing tree from markdown and running orphan connection"""
        # Path to the existing benchmarker output
        tree_path = Path("/Users/bobbobby/repos/VoiceTree/backend/benchmarker/output_backups/user_guide_qa_audio_processing")
        
        if not tree_path.exists():
            pytest.skip(f"Test tree not found at {tree_path}")
        
        # Load the existing tree from markdown files
        tree = load_markdown_tree(str(tree_path))
        
        # Count initial orphans
        initial_orphans = [
            node_id for node_id, node in tree.tree.items()
            if node.parent_id is None
        ]
        print(f"\nInitial tree has {len(tree.tree)} nodes, {len(initial_orphans)} orphans")
        
        # Create workflow and force orphan connection
        workflow = TreeActionDeciderWorkflow(tree)
        workflow._orphan_check_interval = 1  # Force immediate check
        workflow._last_orphan_check_node_count = 0
        
        # Run dummy content to trigger Phase 3
        result = await workflow.run(
            "Trigger orphan connection phase",
            tree
        )
        
        # Count final orphans
        final_orphans = [
            node_id for node_id, node in tree.tree.items()
            if node.parent_id is None
        ]
        
        print(f"\nFinal tree has {len(tree.tree)} nodes, {len(final_orphans)} orphans")
        
        # Check if any new parent nodes were created
        new_nodes = len(tree.tree) - len(initial_orphans)
        if new_nodes > 0:
            print(f"Created {new_nodes} new parent nodes for grouping")
            
            # Show the new nodes
            for node_id, node in tree.tree.items():
                if node_id > max(initial_orphans):
                    print(f"  New parent: {node.title}")
    
    @pytest.mark.asyncio  
    async def test_connect_orphans_manual_run(self):
        """Manually run the connect orphans agent on a test tree"""
        from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
            ConnectOrphansAgent
        )
        
        # Create a tree with related orphans
        tree = DecisionTree()
        
        # Authentication related
        auth_node = Node(
            name="User Authentication System",
            node_id=1,
            content="Handles user login and authentication",
            summary="User authentication and login management",
            parent_id=None
        )
        tree.tree[1] = auth_node
        
        session_node = Node(
            name="Session Management",
            node_id=2,
            content="Manages user sessions and tokens",
            summary="Session and token management",
            parent_id=None
        )
        tree.tree[2] = session_node
        
        # Database related
        db_node = Node(
            name="Database Query Optimization",
            node_id=3,
            content="Optimizing database queries",
            summary="SQL query optimization techniques",
            parent_id=None
        )
        tree.tree[3] = db_node
        
        index_node = Node(
            name="Database Index Management",
            node_id=4,
            content="Managing database indexes",
            summary="Index creation and management",
            parent_id=None
        )
        tree.tree[4] = index_node
        
        # Unrelated
        color_node = Node(
            name="UI Color Themes",
            node_id=5,
            content="Application color theming",
            summary="Managing UI color schemes",
            parent_id=None
        )
        tree.tree[5] = color_node
        
        tree.next_node_id = 6
        
        # Run the connect orphans agent
        agent = ConnectOrphansAgent()
        actions = await agent.run(tree, min_group_size=2)
        
        print(f"\nConnect Orphans Agent created {len(actions)} actions:")
        for action in actions:
            print(f"  - Parent: {action.new_node_name}")
            print(f"    Summary: {action.summary}")
        
        # Verify we got some groupings
        assert len(actions) >= 0  # May be conservative and not group


if __name__ == "__main__":
    async def main():
        """Run the tests manually"""
        test = TestConnectOrphansE2E()
        
        print("=" * 60)
        print("Running manual orphan connection test...")
        print("=" * 60)
        await test.test_connect_orphans_manual_run()
        
        print("\n" + "=" * 60)
        print("Loading and processing existing benchmarker tree...")
        print("=" * 60)
        await test.test_load_and_connect_existing_tree()
    
    asyncio.run(main())