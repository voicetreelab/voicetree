"""
Integration tests for TreeActionDecider orchestrator using real agents.

These tests verify the actual behavior of the two-step pipeline with real LLMs.
They complement the unit tests by ensuring our mocks are realistic.
"""

import pytest
from typing import List

from backend.text_to_graph_pipeline.orchestration.tree_action_decider import TreeActionDecider
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, 
    CreateAction, 
    UpdateAction,
    BaseTreeAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestTreeActionDeciderIntegration:
    """Integration tests with real LLM agents"""
    
    @pytest.fixture
    def orchestrator(self):
        """Create real TreeActionDecider instance"""
        return TreeActionDecider()
    
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
    async def test_simple_append_triggers_reorganization(self, orchestrator, simple_tree):
        """
        Test Case 1: Even simple content can trigger node reorganization
        
        Verifies:
        - Optimizer may reorganize nodes even for simple additions
        - Returns UPDATE and CREATE actions to restructure the tree
        """
        # Simple, atomic content that relates to existing node
        transcript_text = "We should add proper indexing on the users table."
        
        # Run the real pipeline
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=simple_tree,
            transcript_history=""
        )
        
        # The optimizer may decide to reorganize
        assert isinstance(result, list)
        
        # The optimizer's behavior can vary:
        # - It might just update the node
        # - It might update and create child nodes
        # - In rare cases, it might decide no optimization is needed
        if len(result) > 0:
            action_types = {type(action).__name__ for action in result}
            # At minimum, we expect an update if any optimization occurs
            assert 'UpdateAction' in action_types or 'CreateAction' in action_types, \
                "Optimization should produce valid actions"
    
    @pytest.mark.asyncio
    async def test_new_topic_creates_node(self, orchestrator, simple_tree):
        """
        Test Case 2: New topic that creates a new node
        
        Verifies:
        - New topics create new nodes
        - New nodes typically don't need immediate optimization
        """
        # Completely new topic
        transcript_text = "Let's set up monitoring with Prometheus and Grafana."
        
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=simple_tree,
            transcript_history=""
        )
        
        # New atomic nodes usually don't need optimization
        assert isinstance(result, list)
        assert len(result) == 0, "New atomic nodes typically don't need optimization"
    
    @pytest.mark.asyncio
    async def test_complex_append_triggers_optimization(self, orchestrator, simple_tree):
        """
        Test Case 3: Complex content that triggers optimization
        
        Verifies:
        - Adding substantial content can trigger node optimization
        - Optimization actions are properly returned
        """
        # Add complex, multi-faceted content to existing node
        transcript_text = """
        For the database, we need to handle user authentication tables,
        product catalog schema with categories and variants,
        order processing tables with state machines,
        inventory tracking with real-time updates,
        and also set up the analytics data warehouse with ETL pipelines.
        We should consider sharding strategies for scale.
        """
        
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=simple_tree,
            transcript_history=""
        )
        
        # This complex addition might trigger optimization
        assert isinstance(result, list)
        
        # If optimization occurred, verify action structure
        for action in result:
            assert isinstance(action, (UpdateAction, CreateAction))
            if isinstance(action, UpdateAction):
                assert hasattr(action, 'node_id')
                assert hasattr(action, 'new_content')
                assert hasattr(action, 'new_summary')
            elif isinstance(action, CreateAction):
                assert hasattr(action, 'new_node_name')
                assert hasattr(action, 'content')
                assert hasattr(action, 'summary')
    
    @pytest.mark.asyncio
    async def test_multi_segment_handling(self, orchestrator, multi_node_tree):
        """
        Test Case 4: Multiple segments targeting different nodes
        
        Verifies:
        - Multiple segments are handled correctly
        - Each modified node is considered for optimization
        """
        # Content with multiple distinct ideas
        transcript_text = """
        For the API design, let's switch to GraphQL for better flexibility.
        
        In the database layer, we need to add caching with Redis.
        
        We should also create a new authentication service using OAuth2.
        """
        
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=multi_node_tree,
            transcript_history=""
        )
        
        # Verify we get valid actions
        assert isinstance(result, list)
        for action in result:
            assert isinstance(action, (UpdateAction, CreateAction))
            assert action.action in ["UPDATE", "CREATE"]
    
    @pytest.mark.asyncio
    async def test_transcript_history_context(self, orchestrator, simple_tree):
        """
        Test Case 5: Transcript history affects processing
        
        Verifies:
        - History context is properly used
        - Continuation of thoughts is handled correctly
        """
        # Previous context
        transcript_history = "We were discussing database optimization strategies."
        
        # Continuation that makes more sense with history
        transcript_text = "Additionally, we should implement query result caching."
        
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=simple_tree,
            transcript_history=transcript_history
        )
        
        # Should append to database node given context
        assert isinstance(result, list)
        # Verify any returned actions are valid
        for action in result:
            assert isinstance(action, (UpdateAction, CreateAction))
    
    @pytest.mark.asyncio
    async def test_empty_tree_creates_without_optimization(self, orchestrator):
        """
        Test Case 6: Empty tree creates root nodes without optimization
        
        Verifies:
        - Empty tree is handled gracefully
        - New nodes in empty tree don't trigger optimization
        """
        empty_tree = DecisionTree()
        
        transcript_text = "Let's build a task management system with real-time updates."
        
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=empty_tree,
            transcript_history=""
        )
        
        # New nodes in empty tree shouldn't need optimization
        assert isinstance(result, list)
        assert len(result) == 0, "New nodes in empty tree shouldn't trigger optimization"
    
    @pytest.mark.asyncio
    async def test_pipeline_consistency(self, orchestrator, simple_tree):
        """
        Test Case 7: Verify pipeline behavior matches our understanding
        
        This test helps ensure our unit test mocks are realistic
        """
        # Track what the pipeline does internally by checking tree state
        initial_node_count = len(simple_tree.tree)
        
        # Add content that should append
        transcript_text = "Use connection pooling with 100 max connections."
        
        result = await orchestrator.run(
            transcript_text=transcript_text,
            decision_tree=simple_tree,
            transcript_history=""
        )
        
        # Verify the tree was modified (placement happened)
        # Note: We can't directly verify this without accessing internals,
        # but we can verify the optimization response makes sense
        assert isinstance(result, list)
        
        # For simple appends, no optimization should occur
        assert len(result) == 0, "Simple technical detail shouldn't trigger optimization"