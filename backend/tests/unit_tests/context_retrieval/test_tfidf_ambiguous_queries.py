"""
Test TF-IDF implementation for get_most_relevant_nodes function

This test implements the behavioral test from the specification:
Test 5: Handling Ambiguous Queries

Verifies that TF-IDF can handle queries that touch on multiple topics
and select the most relevant node based on key terms.
"""
from backend.markdown_tree_manager.markdown_tree_ds import Node, MarkdownTree
from backend.markdown_tree_manager.graph_search.tree_functions import get_most_relevant_nodes


class TestTfidfAmbiguousQueries:
    """Test TF-IDF functionality with ambiguous queries spanning multiple topics"""
    
    def test_handling_ambiguous_queries(self):
        """
        Test 5: Handling Ambiguous Queries
        
        Verifies that TF-IDF can handle queries that mention concepts from
        multiple nodes but ultimately selects the most relevant one based
        on the primary focus of the query.
        """
        # Create a decision tree
        tree = MarkdownTree()
        
        # Add Node A: Introduction to Databases
        node_a = Node(
            name="Introduction to Databases",
            node_id=1,
            content="# Introduction to Databases\nDatabase fundamentals",
            summary="Relational databases, SQL basics, database design principles",
            parent_id=None
        )
        tree.tree[1] = node_a
        
        # Add Node B: NoSQL and Big Data
        node_b = Node(
            name="NoSQL and Big Data",
            node_id=2,
            content="# NoSQL and Big Data\nNoSQL databases and big data solutions",
            summary="MongoDB, Cassandra, distributed databases, big data processing",
            parent_id=None
        )
        tree.tree[2] = node_b
        
        # Add Node C: Database Performance Optimization
        node_c = Node(
            name="Database Performance Optimization",
            node_id=3,
            content="# Database Performance Optimization\nOptimizing database performance",
            summary="Indexing, query optimization, caching strategies, performance tuning",
            parent_id=None
        )
        tree.tree[3] = node_c
        
        # Query about optimization (mentions databases and records, but focus is optimization)
        query = "How do I optimize my database queries to handle millions of records efficiently without causing timeouts or performance issues"
        
        # Get all nodes to see ranking
        all_results = get_most_relevant_nodes(tree, limit=3, query=query)
        [node.id for node in all_results]
        
        # All nodes should be included
        assert len(all_results) == 3, "Should return all 3 nodes"
        
        # Test with limit=2
        limited_results = get_most_relevant_nodes(tree, limit=2, query=query)
        limited_ids = [node.id for node in limited_results]
        
        # Performance Optimization should be included
        assert 3 in limited_ids, "Performance Optimization should be in top 2"
        
        # Test with limit=1 to get top choice
        result = get_most_relevant_nodes(tree, limit=1, query=query)
        
        assert len(result) == 1, "Should return exactly 1 node"
        assert result[0].id == 3, (
            f"Database Performance Optimization (node 3) should be the top choice "
            f"for optimization-focused query, but got node {result[0].id}: {result[0].title}. "
            f"TF-IDF should prioritize 'optimize', 'performance', 'efficiently' terms."
        )
        
    def test_ambiguous_query_about_basics(self):
        """
        Test with query that could match multiple nodes but has basic focus
        """
        tree = MarkdownTree()
        
        # Same nodes
        tree.tree[1] = Node(
            name="Introduction to Databases",
            node_id=1,
            content="# Introduction to Databases",
            summary="Relational databases, SQL basics, database design principles",
            parent_id=None
        )
        
        tree.tree[2] = Node(
            name="NoSQL and Big Data",
            node_id=2,
            content="# NoSQL and Big Data",
            summary="MongoDB, Cassandra, distributed databases, big data processing",
            parent_id=None
        )
        
        tree.tree[3] = Node(
            name="Database Performance Optimization",
            node_id=3,
            content="# Database Performance Optimization",
            summary="Indexing, query optimization, caching strategies, performance tuning",
            parent_id=None
        )
        
        # Query about SQL basics (ambiguous but focuses on basics)
        basics_query = "I need to learn SQL basics and understand relational database design for my new project"
        
        result = get_most_relevant_nodes(tree, limit=1, query=basics_query)
        
        # Should select Introduction to Databases
        assert result[0].id == 1, (
            f"Introduction to Databases (node 1) should be selected for SQL basics query, "
            f"but got node {result[0].id}: {result[0].title}"
        )
        
    def test_big_data_focused_query(self):
        """
        Test with query focused on big data despite mentioning general database concepts
        """
        tree = MarkdownTree()
        
        # Same nodes
        tree.tree[1] = Node(
            name="Introduction to Databases",
            node_id=1,
            content="# Introduction to Databases",
            summary="Relational databases, SQL basics, database design principles",
            parent_id=None
        )
        
        tree.tree[2] = Node(
            name="NoSQL and Big Data",
            node_id=2,
            content="# NoSQL and Big Data",
            summary="MongoDB, Cassandra, distributed databases, big data processing",
            parent_id=None
        )
        
        tree.tree[3] = Node(
            name="Database Performance Optimization",
            node_id=3,
            content="# Database Performance Optimization",
            summary="Indexing, query optimization, caching strategies, performance tuning",
            parent_id=None
        )
        
        # Query about distributed databases and big data
        big_data_query = "Setting up MongoDB cluster for distributed big data processing with Cassandra fallback"
        
        result = get_most_relevant_nodes(tree, limit=1, query=big_data_query)
        
        # Should select NoSQL and Big Data
        assert result[0].id == 2, (
            f"NoSQL and Big Data (node 2) should be selected for MongoDB/Cassandra query, "
            f"but got node {result[0].id}: {result[0].title}"
        )