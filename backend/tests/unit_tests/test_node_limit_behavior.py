"""
Test Node Limiting Behavior for Long Context Processing

This test ensures that VoiceTree limits the number of nodes sent to the LLM
to prevent long context failures (8000+ tokens).
"""

import json
import pytest
from unittest.mock import Mock, MagicMock
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.text_to_graph_pipeline.tree_manager.tree_functions import get_most_relevant_nodes, _format_nodes_for_prompt
from backend.settings import MAX_NODES_FOR_LLM_CONTEXT


class TestNodeLimitBehavior:
    """Test that node limiting prevents long context failures"""
    
    @pytest.fixture
    def decision_tree_with_many_nodes(self):
        """Create a decision tree with many nodes to simulate long context"""
        tree = DecisionTree()
        
        # Create 50 nodes to simulate a large tree
        for i in range(50):
            node_id = tree.create_new_node(
                name=f"Node {i}",
                parent_node_id=None if i == 0 else (i // 5),  # Create some hierarchy
                content=f"This is content for node {i} with some substantial text to make it realistic. " * 10,
                summary=f"Summary of node {i} containing important information",
                relationship_to_parent="child of" if i > 0 else ""
            )
        
        return tree
    
    def test_node_limit_is_enforced(self, decision_tree_with_many_nodes):
        """Test that only limited nodes are sent to LLM"""
        # Get most relevant nodes using the limit from settings
        relevant_nodes = get_most_relevant_nodes(decision_tree_with_many_nodes, 20)
        
        # Get formatted nodes
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes)
        
        # Parse the JSON to count nodes
        import json
        nodes_list = json.loads(formatted_nodes)
        
        # Assert that only limited nodes are included
        assert len(nodes_list) <= 20, f"Expected at most 20 nodes, but got {len(nodes_list)}"
    
    def test_most_relevant_nodes_are_selected(self, decision_tree_with_many_nodes):
        """Test that most relevant/recent nodes are prioritized"""
        # Modify some recent nodes to mark them as recently updated
        tree = decision_tree_with_many_nodes
        recent_node_ids = [46, 47, 48, 49, 50]  # Last 5 nodes
        for node_id in recent_node_ids:
            tree.append_node_content(node_id, "Recent update")
        
        # Get most relevant nodes with limit
        relevant_nodes = get_most_relevant_nodes(tree, 10)
        
        # Get formatted nodes
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes)
        nodes_list = json.loads(formatted_nodes)
        
        # Extract node IDs from the result
        included_node_ids = [node['id'] for node in nodes_list]
        
        # Assert recent nodes are included
        recent_included = sum(1 for recent_id in recent_node_ids if recent_id in included_node_ids)
        assert recent_included >= 3, f"Expected at least 3 recent nodes, but got {recent_included}"
    
    def test_node_limit_is_configurable(self):
        """Test that node limit can be configured via settings"""
        # Test that MAX_NODES_FOR_LLM_CONTEXT exists and is reasonable
        assert MAX_NODES_FOR_LLM_CONTEXT > 0, "MAX_NODES_FOR_LLM_CONTEXT should be positive"
        assert MAX_NODES_FOR_LLM_CONTEXT <= 50, "MAX_NODES_FOR_LLM_CONTEXT should not be too large"
        
        # Create a tree and test with different limits
        tree = DecisionTree()
        for i in range(30):
            tree.create_new_node(
                name=f"Node {i}",
                parent_node_id=None if i == 0 else 0,
                content=f"Content {i}",
                summary=f"Summary {i}",
                relationship_to_parent="child of" if i > 0 else ""
            )
        
        for limit in [10, 20, 25]:
            nodes = get_most_relevant_nodes(tree, limit)
            assert len(nodes) <= limit, f"Should have at most {limit} nodes"
    
    def test_all_nodes_included_when_under_limit(self):
        """Test that all nodes are included when total is under limit"""
        # Create small tree with only 5 nodes
        small_tree = DecisionTree()
        for i in range(5):
            small_tree.create_new_node(
                name=f"Node {i}",
                parent_node_id=None if i == 0 else 0,
                content=f"Content {i}",
                summary=f"Summary {i}",
                relationship_to_parent="child of" if i > 0 else ""
            )
        
        # Get nodes with limit higher than tree size
        relevant_nodes = get_most_relevant_nodes(small_tree, 20)
        
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes)
        nodes_list = json.loads(formatted_nodes)
        
        # All 5 nodes should be included
        assert len(nodes_list) == 5, f"Expected all 5 nodes, but got {len(nodes_list)}"
    
    def test_node_selection_includes_root_and_recent(self, decision_tree_with_many_nodes):
        """Test that node selection includes both root nodes and recent nodes"""
        # Get most relevant nodes
        relevant_nodes = get_most_relevant_nodes(decision_tree_with_many_nodes, 15)
        
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes)
        nodes_list = json.loads(formatted_nodes)
        
        # Extract node IDs
        included_node_ids = [node['id'] for node in nodes_list]
        
        # Root node (id=1) should always be included
        assert 1 in included_node_ids, "Root node should always be included"
        
        # Some recent nodes should be included
        recent_nodes = [46, 47, 48, 49, 50]
        recent_included = sum(1 for node_id in recent_nodes if node_id in included_node_ids)
        assert recent_included >= 3, f"At least 3 recent nodes should be included, but only {recent_included} were"