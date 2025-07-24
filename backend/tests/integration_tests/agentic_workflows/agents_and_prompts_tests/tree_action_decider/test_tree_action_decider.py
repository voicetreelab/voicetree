"""
Integration tests for TreeActionDecider orchestrator.

This test verifies that TreeActionDecider correctly orchestrates the two-step pipeline:
1. AppendToRelevantNodeAgent determines placement (APPEND/CREATE actions)
2. TreeActionApplier applies placement actions
3. SingleAbstractionOptimizerAgent optimizes modified nodes
4. Returns final optimization actions

Note: These are real integration tests that use actual LLMs (no mocks).

IMPORTANT: The TreeActionDecider is NOT an agent - it's a deterministic orchestrator
that coordinates the workflow between agents. It should be implemented in:
backend/text_to_graph_pipeline/orchestration/tree_action_decider.py

NOTE: This test is currently in agents_and_prompts_tests folder for organizational
reasons, but TreeActionDecider is an orchestrator, not an agent.
"""

import pytest
from typing import List, Union

# This import will fail until the new orchestrator is implemented
# It should NOT inherit from Agent - it's a simple orchestrator
try:
    from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import TreeActionDeciderWorkflow as TreeActionDecider
except ImportError:
    # Expected to fail - create a dummy class for test structure
    class TreeActionDecider:
        async def run(self, transcript_text: str, decision_tree, transcript_history: str = ""):
            raise NotImplementedError("TreeActionDecider orchestrator not implemented yet")
    
# Create alias for backward compatibility with test names
TreeActionDeciderAgent = TreeActionDecider

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, 
    CreateAction, 
    UpdateAction,
    BaseTreeAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestTreeActionDeciderAgent:
    """Integration tests for the complete two-step pipeline orchestrator"""
    
    @pytest.fixture
    def agent(self):
        """Create TreeActionDeciderAgent instance"""
        return TreeActionDeciderAgent()
    
    @pytest.fixture
    def simple_tree(self):
        """Create a simple tree with one node about database design"""
        tree = DecisionTree()
        node = Node(
            name="Database Design",
            node_id=1,
            content="We're using PostgreSQL for our main database.",
            summary="Core database architecture decisions"
        )
        tree.tree[1] = node
        return tree
    
    @pytest.fixture
    def multi_node_tree(self):
        """Create a tree with multiple nodes for testing"""
        tree = DecisionTree()
        
        # Root node about architecture
        arch_node = Node(
            name="System Architecture",
            node_id=1,
            content="We're building a microservices architecture.",
            summary="Overall system design patterns"
        )
        tree.tree[1] = arch_node
        
        # Child node about API design
        api_node = Node(
            name="API Design",
            node_id=2,
            content="Using RESTful endpoints with JSON.",
            summary="REST API design decisions",
            parent_id=1
        )
        tree.tree[2] = api_node
        arch_node.children.append(2)
        
        # Sibling node about database
        db_node = Node(
            name="Database Layer",
            node_id=3,
            content="PostgreSQL with read replicas.",
            summary="Database architecture choices",
            parent_id=1
        )
        tree.tree[3] = db_node
        arch_node.children.append(3)
        
        return tree
    
    @pytest.mark.asyncio
    async def test_full_pipeline_flow(self, agent, multi_node_tree):
        """
        Test Case 1: Complete two-step pipeline with multiple segments
        
        This test verifies:
        - Text gets segmented and placed correctly (some APPEND, some CREATE)
        - Modified nodes are optimized if needed
        - Final optimization actions are returned
        """
        # Input text with multiple ideas - some relate to existing nodes, some are new
        transcript_text = """
        For the database layer, we need to add proper indexing on the users table 
        for performance optimization. Also, let's implement connection pooling.
        
        We should also set up a new monitoring system using Prometheus and Grafana
        to track our system metrics and create alerts for downtime.
        """
        
        # Run the full pipeline
        result = await agent.run(
            transcript_text=transcript_text,
            decision_tree=multi_node_tree,
            transcript_history=""
        )
        
        # Verify we get optimization actions back
        assert isinstance(result, list)
        assert all(isinstance(action, (UpdateAction, CreateAction)) for action in result)
        
        # We expect at least some actions since we're adding content
        # The exact number depends on LLM decisions, but there should be some
        assert len(result) > 0, "Pipeline should produce some optimization actions"
        
        # Check that actions have valid structure
        for action in result:
            if isinstance(action, UpdateAction):
                assert hasattr(action, 'node_id')
                assert hasattr(action, 'new_content')
                assert hasattr(action, 'new_summary')
                assert action.node_id > 0
            elif isinstance(action, CreateAction):
                assert hasattr(action, 'new_node_name')
                assert hasattr(action, 'content')
                assert hasattr(action, 'summary')
    
    @pytest.mark.asyncio
    async def test_no_optimization_needed(self, agent):
        """
        Test Case 2: Simple content handles optimization appropriately
        
        This test verifies:
        - Simple, well-structured content is processed correctly
        - May trigger optimization if the improved prompt identifies enhancements
        """
        # Start with empty tree
        tree = DecisionTree()
        
        # Simple, atomic content
        transcript_text = "Let's create a simple todo list application."
        
        # Run the pipeline
        result = await agent.run(
            transcript_text=transcript_text,
            decision_tree=tree,
            transcript_history=""
        )
        
        # Should handle the content appropriately - may optimize if beneficial
        assert isinstance(result, list)
        # If optimization occurs, it should be valid UPDATE actions
        if len(result) > 0:
            from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction
            assert all(isinstance(action, UpdateAction) for action in result)
            assert all(action.node_id > 0 for action in result)
    
    @pytest.mark.asyncio
    async def test_append_triggers_optimization(self, agent, simple_tree):
        """
        Test Case 3: Appending content that makes node too complex
        
        This test verifies:
        - Appending substantial content triggers optimization
        - Node gets split or reorganized when it becomes overloaded
        """
        # Add complex content to existing database node
        transcript_text = """
        For the database, we need to handle user authentication tables,
        product catalog schema, order processing tables, and also set up
        the analytics data warehouse with proper ETL pipelines.
        """
        
        result = await agent.run(
            transcript_text=transcript_text,
            decision_tree=simple_tree,
            transcript_history=""
        )
        
        # This complex addition should trigger optimization
        assert isinstance(result, list)
        assert len(result) > 0, "Complex append should trigger optimization"
        
        # Check for either UPDATE or CREATE actions from optimization
        action_types = [type(action).__name__ for action in result]
        assert any(t in ['UpdateAction', 'CreateAction'] for t in action_types)
    
    @pytest.mark.asyncio 
    async def test_mixed_content_handling(self, agent, multi_node_tree):
        """
        Test Case 4: Mixed content with clear append and create targets
        
        This test verifies:
        - Some content appends to existing nodes
        - Some content creates new nodes
        - Each modified node is considered for optimization
        """
        transcript_text = """
        Update our API design to use GraphQL instead of REST for better flexibility.
        
        We also need to set up continuous integration using GitHub Actions
        with automated testing and deployment pipelines.
        """
        
        result = await agent.run(
            transcript_text=transcript_text,
            decision_tree=multi_node_tree,
            transcript_history=""
        )
        
        # Should have some actions from optimization
        assert isinstance(result, list)
        
        # Verify action structure
        for action in result:
            assert isinstance(action, (UpdateAction, CreateAction))
            assert action.action in ["UPDATE", "CREATE"]