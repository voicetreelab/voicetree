"""
Test suite for AppendToRelevantNodeAgent with real LLM calls

This agent's responsibilities:
1. Take raw transcript text
2. Segment it into atomic ideas
3. For each segment, identify target node or propose new node
4. Return list of AppendAction or CreateAction objects
"""

from typing import List, Union

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.agents.append_to_relevant_node_agent import \
    AppendToRelevantNodeAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, BaseTreeAction, CreateAction)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import (
    DecisionTree, Node)
from backend.text_to_graph_pipeline.tree_manager.tree_functions import get_most_relevant_nodes, _format_nodes_for_prompt
from backend.settings import MAX_NODES_FOR_LLM_CONTEXT


class TestAppendToRelevantNodeAgent:
    
    @pytest.fixture
    def agent(self):
        """Create an instance of AppendToRelevantNodeAgent"""
        return AppendToRelevantNodeAgent()
    
    @pytest.fixture
    def simple_tree(self):
        """Create a simple tree with one node"""
        tree = DecisionTree()
        node = Node(
            name="Database Design",
            node_id=1,
            content="Initial database design discussions",
            summary="Database architecture decisions"
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        return tree
    
    @pytest.mark.asyncio
    async def test_simple_append(self, agent, simple_tree):
        """Test Case 1: Text clearly relates to existing node"""
        text = "We need to add an index to the users table for performance."
        
        existing_nodes = get_most_relevant_nodes(simple_tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes)
        )
        
        assert len(result.actions) == 1
        assert isinstance(result.actions[0], AppendAction)
        assert result.actions[0].action == "APPEND"
        assert result.actions[0].target_node_id == 1
        assert "index" in result.actions[0].content.lower()
        assert "users table" in result.actions[0].content.lower()
    
    @pytest.mark.asyncio
    async def test_simple_create(self, agent):
        """Test Case 2: Text is unrelated to any existing node"""
        # Create tree with a very specific node to ensure new topic is created
        tree = DecisionTree()
        node = Node(
            name="Frontend React Components",
            node_id=1,
            content="Building UI components with React",
            summary="Frontend development with React"
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        
        text = "We need to configure the PostgreSQL database connection pool settings."
        
        existing_nodes = get_most_relevant_nodes(tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes)
        )
        
        assert len(result.actions) == 1
        assert isinstance(result.actions[0], CreateAction)
        assert result.actions[0].action == "CREATE"
        # Database config is unrelated to React frontend
        assert result.actions[0].parent_node_id is None  # Always orphan nodes
        assert "database" in result.actions[0].orphan_topic_name.lower() or "postgresql" in result.actions[0].orphan_topic_name.lower()
        assert result.actions[0].content == text
    
    @pytest.mark.asyncio
    async def test_mixed_append_and_create(self, agent):
        """Test Case 3: Multiple segments, some append, some create"""
        tree = DecisionTree()
        node = Node(
            name="User Authentication",
            node_id=1,
            content="JWT-based authentication system",
            summary="Auth system design"
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        
        text = "We should enforce stronger password policies. Also, we need to set up rate limiting on the API."
        
        existing_nodes = get_most_relevant_nodes(tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes)
        )
        
        # Should have 2 actions (one for each sentence)
        assert len(result.actions) == 2
        
        # First segment should append to auth node (password policies relate to auth)
        password_action = next((a for a in result.actions if "password" in a.content.lower()), None)
        assert password_action is not None
        assert isinstance(password_action, AppendAction)
        assert password_action.target_node_id == 1
        
        # Second segment could be either append or create (LLM decision)
        rate_limit_action = next((a for a in result.actions if "rate limiting" in a.content.lower()), None)
        assert rate_limit_action is not None
        # Accept either decision - both are reasonable
        assert isinstance(rate_limit_action, (AppendAction, CreateAction))
    
    @pytest.mark.asyncio
    async def test_empty_tree(self, agent):
        """Test Case 4: Empty tree, all creates"""
        tree = DecisionTree()
        
        text = "First, let's define the project requirements. Second, we need to choose a tech stack."
        
        existing_nodes = get_most_relevant_nodes(tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes)
        )
        
        # Should create 2 new nodes
        assert len(result.actions) == 2
        assert all(isinstance(action, CreateAction) for action in result.actions)
        assert all(action.parent_node_id is None for action in result.actions)  # All orphans
        
        # Check node names are reasonable
        node_names = [action.orphan_topic_name.lower() for action in result.actions if isinstance(action, CreateAction)]
        assert any("requirement" in name for name in node_names)
        assert any("tech" in name or "stack" in name for name in node_names)
    
    @pytest.mark.asyncio
    async def test_choosing_more_relevant_node(self, agent):
        """Test Case 5: Agent correctly distinguishes between two related but distinct topics"""
        tree = DecisionTree()
        # Create two nodes
        node1 = Node(
            name="API Security",
            node_id=1,
            content="Authentication, authorization, input validation",
            summary="Security measures for API endpoints"
        )
        node2 = Node(
            name="Database Performance",
            node_id=2,
            content="Query optimization, indexing strategies",
            summary="Database optimization and performance tuning"
        )
        tree.tree[1] = node1
        tree.tree[2] = node2
        tree.next_node_id = 3
        
        text = "We must protect against SQL injection on all endpoints."
        
        existing_nodes = get_most_relevant_nodes(tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes)
        )
        
        assert len(result.actions) == 1
        assert isinstance(result.actions[0], AppendAction)
        # SQL injection protection is a security concern, should go to API Security
        assert result.actions[0].target_node_id == 1
    
    @pytest.mark.asyncio
    async def test_with_transcript_history(self, agent, simple_tree):
        """Test that transcript history provides context for segmentation"""
        text = "and also configure the connection pooling."
        history = "We're setting up PostgreSQL for the main database"
        
        existing_nodes = get_most_relevant_nodes(simple_tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes),
            transcript_history=history
        )
        
        assert len(result.actions) == 1
        assert isinstance(result.actions[0], AppendAction)
        assert result.actions[0].target_node_id == 1  # Should append to Database Design
    
    @pytest.mark.asyncio 
    async def test_incomplete_segments_filtered(self, agent, simple_tree):
        """Test that incomplete segments are properly identified"""
        # Text with clear incomplete ending
        text = "We need to add database indexes to improve query performance. The other important thing we need to consider is how the"
        
        existing_nodes = get_most_relevant_nodes(simple_tree, MAX_NODES_FOR_LLM_CONTEXT)
        result = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree,
            existing_nodes_formatted=_format_nodes_for_prompt(existing_nodes)
        )
        
        # Should have segments
        assert len(result.segments) > 0
        
        # The key test: the agent should handle incomplete segments appropriately
        # Either by marking them incomplete OR by combining them into complete thoughts
        # Both approaches are valid
        
        # If there are incomplete segments, they shouldn't have actions
        incomplete_count = sum(1 for seg in result.segments if not seg.is_routable)
        if incomplete_count > 0:
            # Actions should be less than total segments
            assert len(result.actions) < len(result.segments)
        
        # Verify completed_text only includes complete segments
        if result.completed_text:
            assert "how the" not in result.completed_text  # Incomplete part shouldn't be in completed text