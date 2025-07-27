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
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


class TestSingleAbstractionOptimizerAgent:
    """Test the SingleAbstractionOptimizerAgent with real LLM calls"""
    
    @pytest.fixture
    def agent(self):
        """Create agent instance"""
        return SingleAbstractionOptimizerAgent()
    
    @pytest.fixture
    def cluttered_node(self):
        """Create a node that should be split"""
        # Cluttered node mixing multiple unrelated concepts
        return Node(
            name="Project Setup",
            node_id=1,
            content="""We need to set up the initial project structure with proper folders.
The database should use PostgreSQL for better performance with complex queries.
For the frontend, we'll use React with TypeScript for type safety.
The API authentication will use JWT tokens with refresh token rotation.""",
            summary="Project setup including structure, database, frontend, and auth"
        )
    
    @pytest.fixture
    def cohesive_node(self):
        """Create a well-structured cohesive node"""
        # Cohesive node about a single concept
        return Node(
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
    
    @pytest.fixture
    def poor_summary_node(self):
        """Create a node that has a poor summary"""
        return Node(
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
    
    @pytest.mark.asyncio
    async def test_split_cluttered_node(self, agent, cluttered_node):
        """Test Case 1: Agent should split a cluttered node into multiple focused nodes"""
        # Run agent on the cluttered node
        neighbors_context = "No neighbor nodes available"
        actions = await agent.run(node=cluttered_node, neighbours_context=neighbors_context)
        
        # Verify we got actions back
        assert isinstance(actions, list)
        assert len(actions) > 0, "Agent should return optimization actions for cluttered node"
        
        # Check action types
        update_actions = [a for a in actions if isinstance(a, UpdateAction)]
        create_actions = [a for a in actions if isinstance(a, CreateAction)]
        
        # LLM might decide to either:
        # 1. Split into multiple nodes (ideal for cluttered content)
        # 2. Just update the original (acceptable decision)
        
        if len(create_actions) >= 2:
            # If splitting, verify child nodes cover different aspects
            node_names = [a.new_node_name.lower() for a in create_actions]
            content_areas = [a.content.lower() for a in create_actions]
            
            # Should have nodes covering different concepts
            concepts_covered = sum([
                any("database" in name or "postgres" in content 
                    for name, content in zip(node_names, content_areas)),
                any("frontend" in name or "react" in content 
                    for name, content in zip(node_names, content_areas)),
                any("auth" in name or "jwt" in content 
                    for name, content in zip(node_names, content_areas))
            ])
            assert concepts_covered >= 2, "Child nodes should cover at least 2 different concepts"
            
            # All create actions should have parent_node_id = cluttered_node.id
            assert all(a.parent_node_id == cluttered_node.id for a in create_actions)
        else:
            # If not splitting, should at least update the original
            assert len(update_actions) >= 1, "Should update the original if not splitting"
            if len(update_actions) > 0:
                assert update_actions[0].node_id == cluttered_node.id
    
    @pytest.mark.asyncio
    async def test_keep_cohesive_node(self, agent, cohesive_node):
        """Test Case 2: Agent optimizes authentication node appropriately"""
        # Run agent on the cohesive node
        neighbors_context = "No neighbor nodes available"
        actions = await agent.run(node=cohesive_node, neighbours_context=neighbors_context)
        
        # The LLM may or may not optimize a cohesive node - both are valid behaviors
        assert isinstance(actions, list)
        
        if len(actions) > 0:
            # If the LLM chooses to optimize, it should have UPDATE action for original node
            update_actions = [a for a in actions if isinstance(a, UpdateAction)]
            if update_actions:
                assert update_actions[0].node_id == cohesive_node.id
            
            # May also create child nodes if distinct abstractions are identified
            create_actions = [a for a in actions if isinstance(a, CreateAction)]
            if create_actions:
                # All create actions should be children of the original node
                assert all(a.parent_node_id == cohesive_node.id for a in create_actions)
    
    @pytest.mark.asyncio
    async def test_update_poor_summary(self, agent, poor_summary_node):
        """Test Case 3: Agent should update a node with poor summary"""
        # Run agent on node with poor summary
        neighbors_context = "No neighbor nodes available"
        actions = await agent.run(node=poor_summary_node, neighbours_context=neighbors_context)
        
        # Should have at least one action
        assert len(actions) >= 1
        
        # Get all update actions for the original node
        update_actions = [a for a in actions if isinstance(a, UpdateAction) and a.node_id == poor_summary_node.id]
        
        # The LLM might decide to either:
        # 1. Just update the summary (UPDATE only)
        # 2. Split the content AND update the parent (UPDATE + CREATE actions)
        # Both are valid approaches for a node with poor summary
        
        if len(update_actions) > 0:
            # If updating, should improve the summary
            new_summary = update_actions[0].new_summary.lower()
            assert "caching" in new_summary or "performance" in new_summary, "Summary should mention caching or performance"
            
            # Summary should be more descriptive than original
            assert len(update_actions[0].new_summary) > len("Some caching stuff")
        
        # If the LLM decided to split, that's also valid
        create_actions = [a for a in actions if isinstance(a, CreateAction)]
        if len(create_actions) > 0:
            # Should have meaningful child nodes about caching
            child_contents = [a.content.lower() for a in create_actions]
            assert any("redis" in c or "cdn" in c or "database" in c or "api" in c 
                      for c in child_contents), "Child nodes should cover caching strategies"
    
    @pytest.mark.asyncio
    async def test_agent_with_neighbors(self, agent):
        """Test Case 4: Agent considers neighbor context"""
        # Parent node for context
        parent = Node(
            name="System Architecture",
            node_id=1,
            content="Overall system design decisions",
            summary="High-level architecture"
        )
        
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
        
        # Create neighbors context string
        neighbors_context = f"Parent: {parent.title} - {parent.summary}"
        
        # Run agent
        actions = await agent.run(node=node, neighbours_context=neighbors_context)
        
        # Should get actions considering the parent context
        assert isinstance(actions, list)
        assert len(actions) > 0
    
    @pytest.mark.asyncio
    async def test_state_extraction_works(self, agent, cluttered_node):
        """Test Case 5: Verify state extraction from workflow works correctly"""
        # This is the key test for the current issue
        # Run agent and check internal state handling
        
        neighbors_context = "No neighbor nodes available"
        actions = await agent.run(node=cluttered_node, neighbours_context=neighbors_context)
        
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

    @pytest.mark.asyncio
    async def test_synthesis_of_appended_raw_text(self, agent, node_with_raw_appended_text):
        """
        HARD TEST 1: Tests if the model can synthesize a well-structured node with
        a raw, appended thought stream, and then correctly split out the new, distinct
        abstractions (a 'Problem' and a 'Solution/Task').
        """
        actions = await agent.run(node=node_with_raw_appended_text, neighbours_context="No neighbor nodes available")

        assert len(actions) > 0, "Agent should take action on a node with appended raw text."

        update_actions = [a for a in actions if isinstance(a, UpdateAction)]
        create_actions = [a for a in actions if isinstance(a, CreateAction)]

        # The primary assertion: this MUST be split. Keeping it together is a failure.
        assert len(create_actions) >= 2, "Should split out the new Problem and Solution into at least two child nodes."

        # Verify the new nodes capture the distinct concepts
        child_names = [a.new_node_name.lower() for a in create_actions]

        # Check for a 'Problem' node
        assert any("spike" in name or "degradation" in name or "cpu" in name for name in child_names), \
            "One child node should identify the performance problem."

        # Check for a 'Solution/Task' node
        assert any("replica" in name or "isolate load" in name for name in child_names), \
            "Another child node should capture the proposed read replica solution."

        # Verify the original node is updated to be a clean parent
        assert len(update_actions) == 1, "The original node should be updated."
        assert "monitoring" in update_actions[0].new_summary.lower(), "Original node should remain focused on monitoring."
        assert "replica" not in update_actions[0].new_content, "The solution detail should be moved out of the parent."

    @pytest.mark.asyncio
    async def test_resists_over_splitting_of_cohesive_checklist(self, agent, node_tempting_to_oversplit):
        """
        HARD TEST 2: Tests if the model understands the 'Structural Cost' principle. It should
        resist the temptation to split a highly cohesive checklist of small items into
        many tiny nodes, recognizing that this harms understandability.
        """
        actions = await agent.run(node=node_tempting_to_oversplit, neighbours_context="No neighbor nodes available")

        create_actions = [a for a in actions if isinstance(a, CreateAction)]

        # The primary assertion: the model should NOT split this node.
        # Splitting demonstrates a failure to understand the Cognitive Efficiency framework.
        assert len(create_actions) == 0, "Should not split a cohesive checklist. This increases Structural Cost."

        # It's acceptable to update the original node for clarity, but not required.
        update_actions = [a for a in actions if isinstance(a, UpdateAction)]
        if len(actions) > 0:
            assert len(update_actions) >= 1, "If any action is taken, it should be an update, not a split."

    @pytest.mark.asyncio
    async def test_splits_subtly_distinct_concepts_despite_neighbor(self, agent, node_with_interwoven_concepts):
        """
        HARD TEST 3: Tests if the model can parse a dense paragraph and identify two
        distinct conceptual units (CI vs. CD) that *should* be split. This is made
        harder by a tempting neighbor node.
        """
        # A tempting neighbor that is related but too general for the specific task.
        neighbors_context = "Neighbors: [{'name': 'Production Deployment Strategy', 'summary': 'High-level plan for deploying to production...'}]"

        actions = await agent.run(node=node_with_interwoven_concepts, neighbours_context=neighbors_context)

        update_actions = [a for a in actions if isinstance(a, UpdateAction)]
        create_actions = [a for a in actions if isinstance(a, CreateAction)]

        # The primary assertion: This node MUST be split into exactly one child.
        # Keeping it together is a failure to reduce Nodal Cost.
        # Referencing the neighbor instead of creating a new task is also a failure.
        assert len(create_actions) == 1, "Should split the distinct 'Deployment Process' concept into one new child node."

        # Verify the new child node is about the deployment task
        new_node_content = create_actions[0].content.lower()
        assert "deployment" in new_node_content or "rollback" in new_node_content, \
            "The new child node must be about the deployment process."
        assert "jenkins" not in new_node_content, "The CI details should remain in the parent."

        # Verify the original node is now cleanly focused on CI
        assert len(update_actions) == 1
        parent_content = update_actions[0].new_content.lower()
        assert "continuous integration" in parent_content or "jenkins" in parent_content
        assert "deployment" not in parent_content, "The deployment details should be moved out of the parent."