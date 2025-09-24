"""
Test TF-IDF implementation for get_most_relevant_nodes function

This test implements the behavioral test from the specification:
Test 2: Distinguishing Similar Topics

Verifies that TF-IDF can differentiate between similar Python-related topics
based on specific domain terminology.
"""
from backend.markdown_tree_manager.graph_search.tree_functions import (
    get_most_relevant_nodes,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.markdown_tree_manager.markdown_tree_ds import Node


class TestTfidfSimilarTopics:
    """Test TF-IDF functionality for distinguishing between similar topics"""

    def test_distinguishing_similar_topics(self):
        """
        Test 2: Distinguishing Similar Topics

        Verifies that TF-IDF can correctly differentiate between Python topics
        that share common terminology but focus on different domains.
        """
        # Create a decision tree
        tree = MarkdownTree()

        # Add Node A: Python Programming Basics
        node_a = Node(
            name="Python Programming Basics",
            node_id=1,
            content="# Python Programming Basics\nFundamental Python concepts",
            summary="Variables, data types, control flow, functions, and basic Python syntax",
            parent_id=None
        )
        tree.tree[1] = node_a

        # Add Node B: Python for Data Science
        node_b = Node(
            name="Python for Data Science",
            node_id=2,
            content="# Python for Data Science\nData analysis with Python",
            summary="NumPy, Pandas, data manipulation, statistical analysis with Python",
            parent_id=None
        )
        tree.tree[2] = node_b

        # Add Node C: Web Development with Python
        node_c = Node(
            name="Web Development with Python",
            node_id=3,
            content="# Web Development with Python\nBuilding web applications",
            summary="Django, Flask, REST APIs, web frameworks and server-side Python",
            parent_id=None
        )
        tree.tree[3] = node_c

        # Query about data science libraries
        query = "I need help with pandas dataframes and numpy arrays for analyzing my dataset with statistical methods"

        # Get most relevant nodes with full list
        relevant_nodes_all = get_most_relevant_nodes(tree, limit=3, query=query)
        node_ids_all = [node.id for node in relevant_nodes_all]

        # All nodes should be included with limit=3
        assert len(relevant_nodes_all) == 3, "Should return all 3 nodes"
        assert 2 in node_ids_all, "Python for Data Science node should be included"

        # Test with limit=2 to force selection
        relevant_nodes_limited = get_most_relevant_nodes(tree, limit=2, query=query)
        limited_ids = [node.id for node in relevant_nodes_limited]

        # Data Science should definitely be selected
        assert 2 in limited_ids, "Data Science node should be prioritized with limited selection"

        # Test with limit=1 to ensure Data Science is top choice
        most_relevant = get_most_relevant_nodes(tree, limit=1, query=query)

        assert len(most_relevant) == 1, "Should return exactly 1 node"
        assert most_relevant[0].id == 2, (
            f"Python for Data Science (node 2) should be the top choice for pandas/numpy query, "
            f"but got node {most_relevant[0].id}: {most_relevant[0].title}. "
            f"TF-IDF should prioritize 'pandas', 'numpy', and 'statistical' terms."
        )

    def test_web_development_query(self):
        """
        Test that web development queries correctly identify the web development node
        """
        tree = MarkdownTree()

        # Same nodes as above
        tree.tree[1] = Node(
            name="Python Programming Basics",
            node_id=1,
            content="# Python Programming Basics",
            summary="Variables, data types, control flow, functions, and basic Python syntax",
            parent_id=None
        )

        tree.tree[2] = Node(
            name="Python for Data Science",
            node_id=2,
            content="# Python for Data Science",
            summary="NumPy, Pandas, data manipulation, statistical analysis with Python",
            parent_id=None
        )

        tree.tree[3] = Node(
            name="Web Development with Python",
            node_id=3,
            content="# Web Development with Python",
            summary="Django, Flask, REST APIs, web frameworks and server-side Python",
            parent_id=None
        )

        # Test with web-specific query
        web_query = "How do I create REST APIs with Flask and handle authentication"
        result_web = get_most_relevant_nodes(tree, limit=1, query=web_query)

        # Should select Web Development
        assert result_web[0].id == 3, (
            f"Web Development (node 3) should be selected for Flask/REST API query, "
            f"but got node {result_web[0].id}: {result_web[0].title}"
        )

    def test_basic_python_query(self):
        """
        Test that basic Python queries select the fundamentals node
        """
        tree = MarkdownTree()

        # Same nodes
        tree.tree[1] = Node(
            name="Python Programming Basics",
            node_id=1,
            content="# Python Programming Basics",
            summary="Variables, data types, control flow, functions, and basic Python syntax",
            parent_id=None
        )

        tree.tree[2] = Node(
            name="Python for Data Science",
            node_id=2,
            content="# Python for Data Science",
            summary="NumPy, Pandas, data manipulation, statistical analysis with Python",
            parent_id=None
        )

        tree.tree[3] = Node(
            name="Web Development with Python",
            node_id=3,
            content="# Web Development with Python",
            summary="Django, Flask, REST APIs, web frameworks and server-side Python",
            parent_id=None
        )

        # Test with basic Python query
        basic_query = "How do I use variables and control flow in Python functions"
        result_basic = get_most_relevant_nodes(tree, limit=1, query=basic_query)

        # Should select Python Basics
        assert result_basic[0].id == 1, (
            f"Python Basics (node 1) should be selected for basic syntax query, "
            f"but got node {result_basic[0].id}: {result_basic[0].title}"
        )
