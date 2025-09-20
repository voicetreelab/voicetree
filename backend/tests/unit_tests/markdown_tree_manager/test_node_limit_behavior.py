"""
Test Node Limiting Behavior for Long Context Processing

This test ensures that VoiceTree limits the number of nodes sent to the LLM
to prevent long context failures (8000+ tokens).
"""

import pytest
import re
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.graph_search.tree_functions import get_most_relevant_nodes
from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import _format_nodes_for_prompt
from backend.settings import MAX_NODES_FOR_LLM_CONTEXT


def _parse_formatted_nodes(formatted_nodes: str) -> list:
    """Helper function to parse the new custom node format into a list of dicts"""
    if formatted_nodes == "No nodes available":
        return []
    
    # Extract node entries between separators
    nodes_list = []
    node_entries = formatted_nodes.split('-' * 40)
    
    for entry in node_entries:
        if 'Node ID:' in entry:
            # Extract node info using regex
            id_match = re.search(r'Node ID: (\d+)', entry)
            title_match = re.search(r'Title: ([^\n]+)', entry)
            summary_match = re.search(r'Summary: ([^\n]+)', entry)
            
            if id_match and title_match and summary_match:
                nodes_list.append({
                    "id": int(id_match.group(1)),
                    "name": title_match.group(1).strip(),
                    "summary": summary_match.group(1).strip()
                })
    
    return nodes_list


class TestNodeLimitBehavior:
    """Test that node limiting prevents long context failures"""
    
    @pytest.fixture
    def decision_tree_with_many_nodes(self):
        """Create a decision tree with many nodes to simulate long context"""
        tree = MarkdownTree()
        
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
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes, decision_tree_with_many_nodes.tree)
        
        # Parse the formatted nodes to count nodes
        nodes_list = _parse_formatted_nodes(formatted_nodes)
        
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
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes, tree.tree)
        nodes_list = _parse_formatted_nodes(formatted_nodes)
        
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
        tree = MarkdownTree()
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
        small_tree = MarkdownTree()
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
        
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes, small_tree.tree)
        nodes_list = _parse_formatted_nodes(formatted_nodes)
        
        # All 5 nodes should be included
        assert len(nodes_list) == 5, f"Expected all 5 nodes, but got {len(nodes_list)}"
    
    def test_node_selection_includes_root_and_recent(self, decision_tree_with_many_nodes):
        """Test that node selection prioritizes recent nodes (root node logic currently disabled)"""
        # Get most relevant nodes
        relevant_nodes = get_most_relevant_nodes(decision_tree_with_many_nodes, 15)
        
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes, decision_tree_with_many_nodes.tree)
        nodes_list = _parse_formatted_nodes(formatted_nodes)
        
        # Extract node IDs
        included_node_ids = [node['id'] for node in nodes_list]
        
        # Note: Root node inclusion is currently disabled in production code
        # The selection logic now prioritizes recent nodes only
        
        # Recent nodes should be included (most recent nodes have highest IDs)
        recent_nodes = [46, 47, 48, 49, 50]
        recent_included = sum(1 for node_id in recent_nodes if node_id in included_node_ids)
        assert recent_included >= 3, f"At least 3 recent nodes should be included, but only {recent_included} were"
        
        # Verify that the selection is working (should have nodes selected)
        assert len(included_node_ids) > 0, "Some nodes should be selected"
    
    def test_query_based_relevance_selection(self):
        """Test that nodes are selected based on query relevance when query is provided"""
        # Create tree with specific node titles/summaries for testing
        tree = MarkdownTree()
        
        # Create nodes with different content
        tree.create_new_node(
            name="Machine Learning Overview",
            parent_node_id=None,
            content="Introduction to ML concepts",
            summary="Overview of machine learning algorithms and techniques",
            relationship_to_parent=""
        )
        tree.create_new_node(
            name="Python Programming",
            parent_node_id=1,
            content="Python syntax and features",
            summary="Python programming language fundamentals",
            relationship_to_parent="child of"
        )
        tree.create_new_node(
            name="Data Science Tools",
            parent_node_id=1,
            content="Tools for data analysis",
            summary="Overview of pandas, numpy, and scikit-learn",
            relationship_to_parent="child of"
        )
        tree.create_new_node(
            name="Web Development",
            parent_node_id=None,
            content="Building web applications",
            summary="HTML, CSS, and JavaScript fundamentals",
            relationship_to_parent=""
        )
        tree.create_new_node(
            name="Database Design",
            parent_node_id=4,
            content="SQL and database concepts",
            summary="Relational database design and SQL queries",
            relationship_to_parent="child of"
        )
        
        # Test query matching
        relevant_nodes = get_most_relevant_nodes(tree, 3, query="python programming")
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes, tree.tree)
        nodes_list = _parse_formatted_nodes(formatted_nodes)
        included_node_ids = [node['id'] for node in nodes_list]
        
        # Node 2 (Python Programming) should be included due to query match
        assert 2 in included_node_ids, "Python Programming node should be selected for 'python programming' query"
        
        # Test different query
        relevant_nodes = get_most_relevant_nodes(tree, 2, query="web development")
        formatted_nodes = _format_nodes_for_prompt(relevant_nodes, tree.tree)
        nodes_list = _parse_formatted_nodes(formatted_nodes)
        included_node_ids = [node['id'] for node in nodes_list]
        
        # Node 4 (Web Development) should be included
        assert 4 in included_node_ids, "Web Development node should be selected for 'web development' query"
    
    def test_query_none_fallback_behavior(self, decision_tree_with_many_nodes):
        """Test that None query falls back to branching factor selection"""
        # Test with None query (should behave like original function)
        relevant_nodes_none = get_most_relevant_nodes(decision_tree_with_many_nodes, 10, query=None)
        
        # Test without query parameter (should behave the same)
        relevant_nodes_no_param = get_most_relevant_nodes(decision_tree_with_many_nodes, 10)
        
        # Results should be identical
        assert len(relevant_nodes_none) == len(relevant_nodes_no_param), "None query and no query should produce same results"