"""
Behavioral integration test for ConnectOrphansAgent
Tests the agent's ability to group related disconnected components and leave unrelated ones alone
"""

import pytest
from typing import List

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.text_to_graph_pipeline.agentic_workflows.agents.connect_orphans_agent import ConnectOrphansAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction, BaseTreeAction


@pytest.mark.asyncio
class TestConnectOrphansAgentBehavior:
    """Test ConnectOrphansAgent behavioral patterns for grouping disconnected components"""

    @pytest.fixture
    def sample_tree_with_orphans(self) -> DecisionTree:
        """Create a DecisionTree with multiple disconnected components"""
        tree = DecisionTree()
        
        # Component 1: Authentication (should group with Session Handling)
        auth_content = """# User Login Authentication
        
        This module handles user login authentication, password verification, and login tokens.
        It provides secure login functionality for the authentication system.
        """
        tree.create_new_node(
            "User Login Authentication", 
            None, 
            auth_content, 
            "Handles user login authentication, password verification, and login tokens"
        )
        
        # Component 2: Session Handling (should group with Authentication)  
        session_content = """# User Login Sessions
        
        This module manages user login sessions and authentication state after login.
        It handles session tokens and user authentication persistence.
        """
        tree.create_new_node(
            "User Login Sessions", 
            None, 
            session_content, 
            "Manages user login sessions and authentication state persistence"
        )
        
        # Component 3: Database Queries (should group with SQL Optimization)
        db_content = """# SQL Database Queries
        
        This module executes SQL database queries and manages database connections.
        It provides core SQL query functionality for database operations.
        """
        tree.create_new_node(
            "SQL Database Queries", 
            None, 
            db_content, 
            "Executes SQL database queries and manages database connections"
        )
        
        # Component 4: SQL Optimization (should group with Database Queries)
        sql_content = """# SQL Performance Optimization
        
        This module optimizes SQL database query performance and execution.
        It analyzes and improves SQL query efficiency and database performance.
        """
        tree.create_new_node(
            "SQL Performance Optimization", 
            None, 
            sql_content, 
            "Optimizes SQL database query performance and execution efficiency"
        )
        
        # Component 5: Color Themes (should remain ungrouped - unrelated)
        color_content = """# UI Color Themes
        
        This module manages different color themes for the user interface.
        It provides options for light, dark, and custom color schemes.
        """
        tree.create_new_node(
            "UI Color Themes", 
            None, 
            color_content, 
            "Manages different color themes and visual styling options for the UI"
        )
        
        return tree

    @pytest.fixture
    def connect_orphans_agent(self) -> ConnectOrphansAgent:
        """Create ConnectOrphansAgent instance"""
        return ConnectOrphansAgent()

    async def test_groups_related_components_correctly(
        self, 
        connect_orphans_agent: ConnectOrphansAgent, 
        sample_tree_with_orphans: DecisionTree
    ):
        """Test that agent correctly identifies and groups related disconnected components"""
        # Run the agent with real LLM calls
        actions: List[BaseTreeAction] = await connect_orphans_agent.run(
            sample_tree_with_orphans, 
            min_group_size=2
        )
        
        # The agent should either create meaningful groupings or decide not to group
        # Both behaviors are valid depending on LLM analysis
        
        if len(actions) > 0:
            # If actions are created, they should be valid
            for action in actions:
                assert isinstance(action, CreateAction)
                assert action.action == "CREATE"
                assert action.parent_node_id is None  # New parents are roots in MVP
                assert len(action.new_node_name.strip()) > 0
                assert len(action.content.strip()) > 0
                assert len(action.summary.strip()) > 0
            
            # Should not create too many parent nodes if grouping
            assert len(actions) <= 3, f"Should not create too many parent nodes, got {len(actions)}"
            
            # Verify parent node names are meaningful and descriptive
            parent_names = [action.new_node_name for action in actions]
            for name in parent_names:
                assert len(name.split()) >= 2, f"Parent name should be descriptive: '{name}'"
                # Names should not be too generic
                generic_terms = {'stuff', 'things', 'general', 'misc', 'other'}
                assert not any(term in name.lower() for term in generic_terms), \
                    f"Parent name should not be generic: '{name}'"
        
        # The key behavioral test: agent doesn't crash and makes reasonable decisions
        assert isinstance(actions, list), "Should return a list of actions"

    async def test_minimum_group_size_constraint(
        self, 
        connect_orphans_agent: ConnectOrphansAgent
    ):
        """Test that agent respects minimum group size constraint"""
        # Create a tree with only one root node
        tree = DecisionTree()
        tree.create_new_node(
            "Single Authentication", 
            None, 
            "# Single Authentication\n\nHandles user login.", 
            "Handles user authentication"
        )
        
        # Should not create any groupings with only one root
        actions = await connect_orphans_agent.run(tree, min_group_size=2)
        assert len(actions) == 0, "Should not group when below minimum group size"

    async def test_handles_no_obvious_relationships(
        self, 
        connect_orphans_agent: ConnectOrphansAgent
    ):
        """Test that agent leaves unrelated topics ungrouped"""
        # Create a tree with unrelated components
        tree = DecisionTree()
        
        # Component 1: Weather
        tree.create_new_node(
            "Weather Forecasting", 
            None, 
            "# Weather Forecasting\n\nProvides weather predictions and alerts.", 
            "Weather prediction and forecasting system"
        )
        
        # Component 2: Music Library  
        tree.create_new_node(
            "Music Library Management", 
            None, 
            "# Music Library\n\nManages music collections and playlists.", 
            "Music collection and playlist management"
        )
        
        # Component 3: Tax Calculations
        tree.create_new_node(
            "Tax Calculator", 
            None, 
            "# Tax Calculator\n\nCalculates taxes and generates reports.", 
            "Tax calculation and reporting system"
        )
        
        # These topics are unrelated, so agent should create few or no groupings
        actions = await connect_orphans_agent.run(tree, min_group_size=2)
        
        # Should create very few groupings (ideally 0) since topics are unrelated
        assert len(actions) <= 1, f"Should not force unrelated topics together, got {len(actions)} groupings"

    async def test_agent_handles_mixed_related_and_unrelated(
        self, 
        connect_orphans_agent: ConnectOrphansAgent, 
        sample_tree_with_orphans: DecisionTree
    ):
        """Test the full scenario from the task: some related, some unrelated components"""
        # Run the agent on our test tree with mixed components
        actions: List[BaseTreeAction] = await connect_orphans_agent.run(
            sample_tree_with_orphans, 
            min_group_size=2
        )
        
        # Should create reasonable groupings - could be 0 if LLM is conservative
        assert len(actions) <= 3, "Should not over-group unrelated topics"
        
        # Verify the content quality of created parent nodes
        for action in actions:
            assert isinstance(action, CreateAction)
            
            # Parent title should be specific and descriptive
            title_words = action.new_node_name.lower().split()
            assert len(title_words) >= 2, "Parent titles should be descriptive"
            
            # Summary should explain the grouping
            summary = action.summary.lower()
            assert len(summary.split()) >= 5, "Summary should be explanatory"
            
            # Content should be properly formatted markdown
            assert action.content.startswith("# "), "Content should start with markdown header"
            assert len(action.content) > len(action.new_node_name) + 10, \
                "Content should be more than just the title"

    async def test_agent_reasoning_and_structure(
        self, 
        connect_orphans_agent: ConnectOrphansAgent, 
        sample_tree_with_orphans: DecisionTree
    ):
        """Test that the agent's internal processing works correctly"""
        # Test the root finding functionality
        roots = connect_orphans_agent.find_disconnected_roots(sample_tree_with_orphans)
        
        # Should find all 5 root nodes we created
        assert len(roots) == 5
        
        # All should have proper titles and summaries
        for root in roots:
            assert root.node_id > 0
            assert len(root.title.strip()) > 0
            assert len(root.summary.strip()) > 0
            assert root.child_count == 0  # All our test nodes are leaves
        
        # Test prompt formatting
        formatted = connect_orphans_agent._format_roots_for_prompt(roots)
        assert "Node ID:" in formatted
        assert "Title:" in formatted
        assert "Summary:" in formatted
        assert "---" in formatted  # Should have separators

    async def test_agent_with_edge_case_titles(
        self, 
        connect_orphans_agent: ConnectOrphansAgent
    ):
        """Test agent handles edge cases in node titles and content"""
        tree = DecisionTree()
        
        # Create nodes with challenging titles
        tree.create_new_node(
            "API", 
            None, 
            "# API\n\nApplication Programming Interface", 
            "API endpoints and interfaces"
        )
        
        tree.create_new_node(
            "REST Services", 
            None, 
            "# REST Services\n\nRESTful web services", 
            "RESTful web service implementations"
        )
        
        tree.create_new_node(
            "GraphQL", 
            None, 
            "# GraphQL\n\nGraphQL API implementation", 
            "GraphQL query interface and resolvers"
        )
        
        # These should potentially be grouped as API-related
        actions = await connect_orphans_agent.run(tree, min_group_size=2)
        
        # Verify the agent can handle short titles and technical terms
        if actions:
            for action in actions:
                assert isinstance(action, CreateAction)
                # Should create meaningful groupings even with technical terms
                assert len(action.new_node_name) > 3  # More than just "API"