# """
# Integration tests for the Connect Orphans Agent.
#
# Tests the agent's ability to identify and group disconnected tree components
# using the LongBenchV2 example as described in the requirements.
# """
#
# import asyncio
# import logging
# from typing import List
#
# import pytest
# from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import (
#     ConnectOrphansAgent, RootNodeInfo, RootGrouping
# )
# from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
# from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction
#
#
# logging.basicConfig(level=logging.INFO)
#
#
# class TestConnectOrphansAgent:
#     """Test suite for Connect Orphans Agent"""
#
#     @pytest.fixture
#     def sample_disconnected_tree(self):
#         """Create a sample tree with multiple disconnected components"""
#         tree = DecisionTree()
#
#         # Component 1: Authentication system
#         auth_root = Node(
#             name="User Authentication",
#             node_id=1,
#             content="User authentication system overview",
#             summary="Handles user login and authentication",
#             parent_id=None
#         )
#         tree.tree[1] = auth_root
#
#         password_node = Node(
#             name="Password Management",
#             node_id=2,
#             content="Password hashing and storage",
#             summary="Secure password handling",
#             parent_id=1
#         )
#         tree.tree[2] = password_node
#         auth_root.children.append(2)
#
#         # Component 2: Session handling (orphan)
#         session_root = Node(
#             name="Session Handling",
#             node_id=3,
#             content="User session management",
#             summary="Manages active user sessions",
#             parent_id=None
#         )
#         tree.tree[3] = session_root
#
#         # Component 3: Database operations
#         db_root = Node(
#             name="Database Queries",
#             node_id=4,
#             content="Database query optimization",
#             summary="Optimizing SQL queries for performance",
#             parent_id=None
#         )
#         tree.tree[4] = db_root
#
#         index_node = Node(
#             name="Index Management",
#             node_id=5,
#             content="Database index strategies",
#             summary="Managing database indexes",
#             parent_id=4
#         )
#         tree.tree[5] = index_node
#         db_root.children.append(5)
#
#         # Component 4: SQL optimization (orphan)
#         sql_root = Node(
#             name="SQL Optimization",
#             node_id=6,
#             content="Query performance tuning",
#             summary="Techniques for SQL query optimization",
#             parent_id=None
#         )
#         tree.tree[6] = sql_root
#
#         # Component 5: Unrelated - Color themes
#         color_root = Node(
#             name="Color Themes",
#             node_id=7,
#             content="Application color theming",
#             summary="Managing UI color schemes",
#             parent_id=None
#         )
#         tree.tree[7] = color_root
#
#         tree.next_node_id = 8
#         return tree
#
#     @pytest.fixture
#     def agent(self):
#         """Create a Connect Orphans Agent instance"""
#         return ConnectOrphansAgent()
#
#     def test_find_disconnected_roots(self, agent, sample_disconnected_tree):
#         """Test finding all root nodes in a disconnected tree"""
#         roots = agent.find_disconnected_roots(sample_disconnected_tree)
#
#         # Should find 5 root nodes (components)
#         assert len(roots) == 5
#
#         # Check that all roots are correctly identified
#         root_titles = {root.title for root in roots}
#         expected_titles = {
#             "User Authentication",
#             "Session Handling",
#             "Database Queries",
#             "SQL Optimization",
#             "Color Themes"
#         }
#         assert root_titles == expected_titles
#
#         # Verify child counts
#         auth_root = next(r for r in roots if r.title == "User Authentication")
#         assert auth_root.child_count == 1
#
#         db_root = next(r for r in roots if r.title == "Database Queries")
#         assert db_root.child_count == 1
#
#     @pytest.mark.asyncio
#     async def test_identify_groupings(self, agent):
#         """Test LLM-based grouping of related roots"""
#         # Create mock root nodes
#         roots = [
#             RootNodeInfo(
#                 node_id=1,
#                 title="User Authentication",
#                 summary="Handles user login and authentication",
#                 child_count=1
#             ),
#             RootNodeInfo(
#                 node_id=3,
#                 title="Session Handling",
#                 summary="Manages active user sessions",
#                 child_count=0
#             ),
#             RootNodeInfo(
#                 node_id=4,
#                 title="Database Queries",
#                 summary="Optimizing SQL queries for performance",
#                 child_count=1
#             ),
#             RootNodeInfo(
#                 node_id=6,
#                 title="SQL Optimization",
#                 summary="Techniques for SQL query optimization",
#                 child_count=0
#             ),
#             RootNodeInfo(
#                 node_id=7,
#                 title="Color Themes",
#                 summary="Managing UI color schemes",
#                 child_count=0
#             )
#         ]
#
#         # This would call the actual LLM in a real test
#         # For unit testing, we'd mock the LLM response
#         # groupings = await agent.identify_groupings(roots)
#
#         # Expected behavior:
#         # - Group 1: User Authentication + Session Handling -> "Security and Authentication"
#         # - Group 2: Database Queries + SQL Optimization -> "Database Performance"
#         # - Ungrouped: Color Themes (no obvious relationship)
#         pass
#
#     @pytest.mark.asyncio
#     async def test_create_connection_actions(self, agent, sample_disconnected_tree):
#         """Test creating tree actions for connecting grouped roots"""
#         # Mock groupings
#         groupings = [
#             RootGrouping(
#                 root_node_ids=[1, 3],
#                 parent_title="Security and Authentication System",
#                 parent_summary="User authentication and session management",
#                 relationship="is_a_category_of"
#             ),
#             RootGrouping(
#                 root_node_ids=[4, 6],
#                 parent_title="Database Performance Management",
#                 parent_summary="Database query optimization and performance",
#                 relationship="is_a_theme_grouping_of"
#             )
#         ]
#
#         actions = await agent.create_connection_actions(
#             sample_disconnected_tree,
#             groupings
#         )
#
#         # Should create 2 parent node actions
#         assert len(actions) == 2
#         assert all(isinstance(action, CreateAction) for action in actions)
#
#         # Check first parent node
#         auth_parent = actions[0]
#         assert auth_parent.new_node_name == "Security and Authentication System"
#         assert auth_parent.parent_node_id is None  # Parent nodes are roots for MVP
#         assert "authentication and session management" in auth_parent.summary
#
#         # Check second parent node
#         db_parent = actions[1]
#         assert db_parent.new_node_name == "Database Performance Management"
#         assert "query optimization and performance" in db_parent.summary
#
#     @pytest.mark.asyncio
#     async def test_full_workflow(self, agent, sample_disconnected_tree):
#         """Test the complete workflow of connecting orphan nodes"""
#         # Run the full connection process
#         actions = await agent.run(
#             tree=sample_disconnected_tree,
#             min_group_size=2,
#             max_roots_to_process=10
#         )
#
#         # The actual groupings depend on LLM response
#         # For integration testing, we'd check:
#         # - Actions were created
#         # - Actions are valid CreateActions
#         # - Parent nodes have appropriate titles/summaries
#
#         if actions:
#             assert all(isinstance(action, CreateAction) for action in actions)
#             for action in actions:
#                 assert action.parent_node_id is None  # MVP: parents are roots
#                 assert action.new_node_name  # Has a title
#                 assert action.summary  # Has a summary
#
#     @pytest.mark.asyncio
#     async def test_min_group_size_constraint(self, agent):
#         """Test that minimum group size is enforced"""
#         tree = DecisionTree()
#
#         # Create only one orphan node
#         single_root = Node(
#             name="Single Component",
#             node_id=1,
#             content="A single disconnected component",
#             summary="Only one root node",
#             parent_id=None
#         )
#         tree.tree[1] = single_root
#         tree.next_node_id = 2
#
#         # Should not create any groupings with only 1 root
#         actions = await agent.run(
#             tree=tree,
#             min_group_size=2
#         )
#
#         assert len(actions) == 0  # No groupings possible
#
#
# if __name__ == "__main__":
#     # Run a simple test
#     async def main():
#         agent = ConnectOrphansAgent()
#         tree = DecisionTree()
#
#         # Create a simple disconnected tree
#         for i in range(1, 6):
#             node = Node(
#                 name=f"Component {i}",
#                 node_id=i,
#                 content=f"Content for component {i}",
#                 summary=f"Summary of component {i}",
#                 parent_id=None
#             )
#             tree.tree[i] = node
#
#         tree.next_node_id = 6
#
#         print("Finding disconnected roots...")
#         roots = agent.find_disconnected_roots(tree)
#         print(f"Found {len(roots)} disconnected roots")
#
#         print("\nRunning connection mechanism...")
#         actions = await agent.run(tree)
#         print(f"Created {len(actions)} connection actions")
#
#         for action in actions:
#             print(f"  - New parent: {action.new_node_name}")
#
#     asyncio.run(main())