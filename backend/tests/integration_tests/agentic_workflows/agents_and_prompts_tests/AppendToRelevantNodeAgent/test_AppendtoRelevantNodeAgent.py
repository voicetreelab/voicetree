"""
Test suite for AppendToRelevantNodeAgent with real LLM calls

This agent's responsibilities:
1. Take raw transcript text
2. Segment it into atomic ideas
3. For each segment, identify target node or propose new node
4. Return list of AppendAction or CreateAction objects
"""

import pytest
from typing import List, Union

from backend.text_to_graph_pipeline.agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, CreateAction, BaseTreeAction
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


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
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree
        )
        
        assert len(actions) == 1
        assert isinstance(actions[0], AppendAction)
        assert actions[0].action == "APPEND"
        assert actions[0].target_node_id == 1
        assert "index" in actions[0].content.lower()
        assert "users table" in actions[0].content.lower()
    
    @pytest.mark.asyncio
    async def test_simple_create(self, agent, simple_tree):
        """Test Case 2: Text is unrelated to any existing node"""
        text = "Let's set up the new CI/CD pipeline using GitHub Actions."
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree
        )
        
        assert len(actions) == 1
        assert isinstance(actions[0], CreateAction)
        assert actions[0].action == "CREATE"
        # LLM should recognize CI/CD as unrelated to Database Design
        assert actions[0].parent_node_id is None  # Always orphan nodes
        assert "CI" in actions[0].new_node_name or "pipeline" in actions[0].new_node_name.lower()
        assert actions[0].content == text
    
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
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=tree
        )
        
        # Should have 2 actions (one for each sentence)
        assert len(actions) == 2
        
        # First segment should append to auth node (password policies relate to auth)
        password_action = next((a for a in actions if "password" in a.content.lower()), None)
        assert password_action is not None
        assert isinstance(password_action, AppendAction)
        assert password_action.target_node_id == 1
        
        # Second segment should create new node (rate limiting is separate concern)
        rate_limit_action = next((a for a in actions if "rate limiting" in a.content.lower()), None)
        assert rate_limit_action is not None
        assert isinstance(rate_limit_action, CreateAction)
        assert rate_limit_action.parent_node_id is None  # Orphan node
    
    @pytest.mark.asyncio
    async def test_empty_tree(self, agent):
        """Test Case 4: Empty tree, all creates"""
        tree = DecisionTree()
        
        text = "First, let's define the project requirements. Second, we need to choose a tech stack."
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=tree
        )
        
        # Should create 2 new nodes
        assert len(actions) == 2
        assert all(isinstance(action, CreateAction) for action in actions)
        assert all(action.parent_node_id is None for action in actions)  # All orphans
        
        # Check node names are reasonable
        node_names = [action.new_node_name.lower() for action in actions if isinstance(action, CreateAction)]
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
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=tree
        )
        
        assert len(actions) == 1
        assert isinstance(actions[0], AppendAction)
        # SQL injection protection is a security concern, should go to API Security
        assert actions[0].target_node_id == 1
    
    @pytest.mark.asyncio
    async def test_with_transcript_history(self, agent, simple_tree):
        """Test that transcript history provides context for segmentation"""
        text = "and also configure the connection pooling."
        history = "We're setting up PostgreSQL for the main database"
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree,
            transcript_history=history
        )
        
        assert len(actions) == 1
        assert isinstance(actions[0], AppendAction)
        assert actions[0].target_node_id == 1  # Should append to Database Design
    
    @pytest.mark.asyncio 
    async def test_incomplete_segments_filtered(self, agent, simple_tree):
        """Test that incomplete segments are not processed"""
        text = "We need to configure the database indexes. But the main thing is"
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree
        )
        
        # Should only process the complete first sentence
        assert len(actions) == 1
        assert isinstance(actions[0], AppendAction)
        assert "indexes" in actions[0].content
        # The incomplete "But the main thing is" should not appear in any action
        assert not any("But the main thing is" in action.content for action in actions)