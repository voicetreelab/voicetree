"""
Integration tests for SingleAbstractionOptimizerAgent

These tests verify the agent correctly:
1. Analyzes nodes and decides if optimization is needed
2. Splits cluttered nodes into multiple focused nodes  
3. Keeps cohesive nodes unchanged
4. Updates poorly summarized nodes
5. Properly extracts LLM responses from workflow state
"""

import pytest
from typing import List

from backend.text_to_graph_pipeline.agentic_workflows.agents.single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, CreateAction, BaseTreeAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestSingleAbstractionOptimizerAgent:
    """Test the SingleAbstractionOptimizerAgent with real LLM calls"""
    
    @pytest.fixture
    def agent(self):
        """Create agent instance"""
        return SingleAbstractionOptimizerAgent()
    
    @pytest.fixture
    def tree_with_cluttered_node(self):
        """Create a tree with a node that should be split"""
        tree = DecisionTree()
        
        # Cluttered node mixing multiple unrelated concepts
        node = Node(
            name="Project Setup",
            node_id=1,
            content="""We need to set up the initial project structure with proper folders.
The database should use PostgreSQL for better performance with complex queries.
For the frontend, we'll use React with TypeScript for type safety.
The API authentication will use JWT tokens with refresh token rotation.""",
            summary="Project setup including structure, database, frontend, and auth"
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        
        return tree
    
    @pytest.fixture
    def tree_with_cohesive_node(self):
        """Create a tree with a well-structured cohesive node"""
        tree = DecisionTree()
        
        # Cohesive node about a single concept
        node = Node(
            name="User Authentication Flow",
            node_id=1,
            content="""The authentication process works as follows:
1. User submits credentials to /api/auth/login
2. Server validates credentials against the database
3. If valid, server generates JWT access token (15 min) and refresh token (7 days)
4. Tokens are returned to client in HTTP-only cookies
5. Client includes access token in Authorization header for API requests
6. When access token expires, client uses refresh token to get new access token""",
            summary="Complete authentication flow implementation details"
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        
        return tree
    
    @pytest.fixture
    def tree_with_poor_summary(self):
        """Create a tree with a node that has a poor summary"""
        tree = DecisionTree()
        
        node = Node(
            name="Performance Optimization",
            node_id=1,
            content="""We implemented caching at multiple levels:
- Redis for session data (TTL: 1 hour)
- CDN for static assets
- Database query caching with 5 minute TTL
- API response caching for GET requests

This reduced our average response time from 800ms to 200ms.""",
            summary="Some caching stuff"  # Poor summary
        )
        tree.tree[1] = node
        tree.next_node_id = 2
        
        return tree
    
    @pytest.mark.asyncio
    async def test_split_cluttered_node(self, agent, tree_with_cluttered_node):
        """Test Case 1: Agent should split a cluttered node into multiple focused nodes"""
        # Run agent on the cluttered node
        actions = await agent.run(node_id=1, decision_tree=tree_with_cluttered_node)
        
        # Verify we got actions back
        assert isinstance(actions, list)
        assert len(actions) > 0, "Agent should return optimization actions for cluttered node"
        
        # Check action types
        update_actions = [a for a in actions if isinstance(a, UpdateAction)]
        create_actions = [a for a in actions if isinstance(a, CreateAction)]
        
        # Should update the original node
        assert len(update_actions) == 1, "Should have exactly one UPDATE action for parent"
        assert update_actions[0].node_id == 1
        assert update_actions[0].action == "UPDATE"
        
        # Should create multiple child nodes
        assert len(create_actions) >= 3, "Should create at least 3 child nodes for different concepts"
        
        # Verify child nodes cover the different concepts
        node_names = [a.new_node_name.lower() for a in create_actions]
        content_areas = [a.content.lower() for a in create_actions]
        
        # Check that key concepts are separated
        assert any("database" in name or "postgres" in content 
                  for name, content in zip(node_names, content_areas))
        assert any("frontend" in name or "react" in content 
                  for name, content in zip(node_names, content_areas))
        assert any("auth" in name or "jwt" in content 
                  for name, content in zip(node_names, content_areas))
        
        # All create actions should have parent_node_id = 1
        assert all(a.parent_node_id == 1 for a in create_actions)
    
    @pytest.mark.asyncio
    async def test_keep_cohesive_node(self, agent, tree_with_cohesive_node):
        """Test Case 2: Agent should not split a cohesive node"""
        # Run agent on the cohesive node
        actions = await agent.run(node_id=1, decision_tree=tree_with_cohesive_node)
        
        # Should either return empty list or single UPDATE action
        assert isinstance(actions, list)
        
        if len(actions) > 0:
            # If any action, should be single UPDATE to improve summary
            assert len(actions) == 1, "Cohesive node should have at most one UPDATE action"
            assert isinstance(actions[0], UpdateAction)
            assert actions[0].node_id == 1
            
            # Should not create any child nodes
            create_actions = [a for a in actions if isinstance(a, CreateAction)]
            assert len(create_actions) == 0, "Should not split cohesive node"
    
    @pytest.mark.asyncio
    async def test_update_poor_summary(self, agent, tree_with_poor_summary):
        """Test Case 3: Agent should update a node with poor summary"""
        # Run agent on node with poor summary
        actions = await agent.run(node_id=1, decision_tree=tree_with_poor_summary)
        
        # Should have exactly one UPDATE action
        assert len(actions) == 1
        assert isinstance(actions[0], UpdateAction)
        assert actions[0].node_id == 1
        
        # Should improve the summary
        new_summary = actions[0].new_summary.lower()
        assert "caching" in new_summary, "Summary should mention caching"
        assert any(word in new_summary for word in ["performance", "response", "200ms", "optimization"])
        
        # Summary should be more descriptive than original
        assert len(actions[0].new_summary) > len("Some caching stuff")
    
    @pytest.mark.asyncio
    async def test_agent_with_neighbors(self, agent):
        """Test Case 4: Agent considers neighbor context"""
        tree = DecisionTree()
        
        # Parent node
        parent = Node(
            name="System Architecture",
            node_id=1,
            content="Overall system design decisions",
            summary="High-level architecture"
        )
        tree.tree[1] = parent
        
        # Node to optimize with parent context
        node = Node(
            name="Database Design",
            node_id=2,
            content="""We need user tables, product catalog, and order processing.
Also need to set up monitoring and alerts for the database.
Plus configure backup strategies and replication.""",
            summary="Database stuff",
            parent_id=1
        )
        tree.tree[2] = node
        parent.children.append(2)
        
        tree.next_node_id = 3
        
        # Run agent
        actions = await agent.run(node_id=2, decision_tree=tree)
        
        # Should get actions considering the parent context
        assert isinstance(actions, list)
        assert len(actions) > 0
    
    @pytest.mark.asyncio
    async def test_state_extraction_works(self, agent, tree_with_cluttered_node):
        """Test Case 5: Verify state extraction from workflow works correctly"""
        # This is the key test for the current issue
        # Run agent and check internal state handling
        
        actions = await agent.run(node_id=1, decision_tree=tree_with_cluttered_node)
        
        # Basic checks that extraction worked
        assert actions is not None
        assert isinstance(actions, list)
        assert all(isinstance(a, BaseTreeAction) for a in actions)
        
        # Verify the actions have proper structure
        for action in actions:
            assert hasattr(action, 'action')
            assert action.action in ["UPDATE", "CREATE"]
            
            if isinstance(action, UpdateAction):
                assert hasattr(action, 'node_id')
                assert hasattr(action, 'new_content')
                assert hasattr(action, 'new_summary')
            elif isinstance(action, CreateAction):
                assert hasattr(action, 'parent_node_id')
                assert hasattr(action, 'new_node_name')
                assert hasattr(action, 'content')
                assert hasattr(action, 'summary')
                assert hasattr(action, 'relationship')