# Aggregated Changes from Last 7 Commits

Generated on: Fri Jul 18 12:26:41 CEST 2025

## List of files changed:
backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py,backend/tests/integration_tests/agentic_workflows/identify_target_node/test_identify_target_node_prompt.py,backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/test_single_abstraction_optimizer_prompt.py,backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py,backend/tests/integration_tests/agentic_workflows/tree_action_decider/test_tree_action_decider.py,backend/tests/module_tests/test_tree_action_applier_update.py,backend/tests/unit_tests/test_decision_tree_ds.py,backend/text_to_graph_pipeline/agentic_workflows/agentic_TDD.md,backend/text_to_graph_pipeline/agentic_workflows/models.py,backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_claude.md,backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan.md,backend/text_to_graph_pipeline/agentic_workflows/new_pipeline.md,backend/text_to_graph_pipeline/agentic_workflows/prompts/identify_target_node.md,backend/text_to_graph_pipeline/agentic_workflows/prompts/segmentation.md,backend/text_to_graph_pipeline/agentic_workflows/prompts/single_abstraction_optimizer.md,backend/text_to_graph_pipeline/agentic_workflows/single_abstraction_optimiser_approach.md,backend/text_to_graph_pipeline/agentic_workflows/VoiceTree_Math.md,backend/text_to_graph_pipeline/chunk_processing_pipeline/apply_tree_actions.py,backend/text_to_graph_pipeline/tree_manager/decision_tree_ds.py

---

## Filename: backend/tests/integration_tests/agentic_workflows/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py

```
```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/identify_target_node/test_identify_target_node_prompt.py

```
"""
Integration test for identify_target_node prompt
Tests that the prompt correctly identifies target nodes for segments
"""

import pytest
import asyncio
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import get_llm
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptEngine
from backend.text_to_graph_pipeline.agentic_workflows.models import TargetNodeResponse


class TestIdentifyTargetNodePrompt:
    """Test the identify_target_node prompt with real LLM calls"""
    
    @pytest.fixture
    def llm(self):
        """Get LLM instance for testing"""
        return get_llm()
    
    @pytest.fixture 
    def prompt_engine(self):
        """Get prompt engine instance"""
        return PromptEngine()
    
    async def test_existing_node_identification(self, llm, prompt_engine):
        """Test identifying segments that should go to existing nodes"""
        # Test data
        existing_nodes = """
        [
            {"name": "Voice Tree Architecture", "summary": "Overall system design and components"},
            {"name": "Database Design", "summary": "Schema and data model decisions"}
        ]
        """
        
        segments = """
        [
            {"text": "We need to add caching to improve voice tree performance", "is_complete": true},
            {"text": "The database indexes need optimization for faster queries", "is_complete": true}
        ]
        """
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await llm.ainvoke(messages)
        result = TargetNodeResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # First segment about caching should go to Architecture
        assert result.target_nodes[0].target_node_name == "Voice Tree Architecture"
        assert result.target_nodes[0].is_new_node == False
        assert "caching" in result.target_nodes[0].text
        
        # Second segment about DB should go to Database Design  
        assert result.target_nodes[1].target_node_name == "Database Design"
        assert result.target_nodes[1].is_new_node == False
        assert "database" in result.target_nodes[1].text.lower()
    
    async def test_new_node_creation(self, llm, prompt_engine):
        """Test identifying segments that need new nodes"""
        # Test data  
        existing_nodes = """
        [
            {"name": "Backend API", "summary": "REST API implementation"}
        ]
        """
        
        segments = """
        [
            {"text": "We should add user authentication with JWT tokens", "is_complete": true},
            {"text": "Need to implement real-time notifications using WebSockets", "is_complete": true}
        ]
        """
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("identify_target_node")
        messages = prompt_engine.format_prompt(
            prompt,
            existing_nodes=existing_nodes,
            segments=segments
        )
        
        response = await llm.ainvoke(messages)
        result = TargetNodeResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.target_nodes) == 2
        
        # Both should create new nodes since they're new concepts
        assert result.target_nodes[0].is_new_node == True
        assert "auth" in result.target_nodes[0].target_node_name.lower()
        
        assert result.target_nodes[1].is_new_node == True
        assert "notification" in result.target_nodes[1].target_node_name.lower() or \
               "websocket" in result.target_nodes[1].target_node_name.lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/test_single_abstraction_optimizer_prompt.py

```
"""
Integration test for single_abstraction_optimizer prompt
Tests the optimization decisions for node abstraction levels
"""

import pytest
import asyncio
from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import get_llm
from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptEngine
from backend.text_to_graph_pipeline.agentic_workflows.models import OptimizationResponse, UpdateAction, CreateAction


class TestSingleAbstractionOptimizerPrompt:
    """Test the single_abstraction_optimizer prompt with real LLM calls"""
    
    @pytest.fixture
    def llm(self):
        """Get LLM instance for testing"""
        return get_llm()
    
    @pytest.fixture 
    def prompt_engine(self):
        """Get prompt engine instance"""
        return PromptEngine()
    
    async def test_split_cluttered_node(self, llm, prompt_engine):
        """
        Test Case 1: A cluttered node that should be split
        Current bloated node = (A,B,C,D), where optimal is A->B, A->C, B->D
        """
        # Test data - a node with multiple unrelated concepts
        node_content = """
        # Project Planning
        
        We need to set up the initial project structure with proper folders.
        
        The database should use PostgreSQL for better performance with complex queries.
        
        For the frontend, we'll use React with TypeScript for type safety.
        
        The API authentication will use JWT tokens with refresh token rotation.
        """
        
        node_summary = "Project setup including structure, database choice, frontend framework, and authentication"
        node_id = 1
        node_name = "Project Planning"
        
        neighbors = [
            {"id": 2, "name": "Development Tasks", "summary": "List of development tasks", "relationship": "sibling"}
        ]
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("single_abstraction_optimizer")
        messages = prompt_engine.format_prompt(
            prompt,
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )
        
        response = await llm.ainvoke(messages)
        result = OptimizationResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.optimization_decision.actions) > 0
        
        # Should have UPDATE action for parent and CREATE actions for children
        update_actions = [a for a in result.optimization_decision.actions if isinstance(a, UpdateAction)]
        create_actions = [a for a in result.optimization_decision.actions if isinstance(a, CreateAction)]
        
        assert len(update_actions) == 1  # Should update the parent node
        assert update_actions[0].node_id == node_id
        
        # Should create multiple child nodes
        assert len(create_actions) >= 3
        
        # Check that nodes cover the different concepts
        node_names = [a.new_node_name.lower() for a in create_actions]
        
        # Should have nodes for database, frontend, auth
        assert any("database" in name or "postgres" in name for name in node_names)
        assert any("frontend" in name or "react" in name for name in node_names)
        assert any("auth" in name or "jwt" in name for name in node_names)
    
    async def test_keep_cohesive_node(self, llm, prompt_engine):
        """
        Test Case 2: A cohesive node that should stay as a single node
        Node with related content that forms a single abstraction
        """
        # Test data - a node with cohesive, related content
        node_content = """
        # User Authentication Flow
        
        The authentication process works as follows:
        1. User submits credentials to /api/auth/login
        2. Server validates credentials against the database
        3. If valid, server generates JWT access token (15 min) and refresh token (7 days)
        4. Tokens are returned to client in HTTP-only cookies
        5. Client includes access token in Authorization header for API requests
        6. When access token expires, client uses refresh token to get new access token
        """
        
        node_summary = "Complete authentication flow implementation details"
        node_id = 5
        node_name = "User Authentication Flow"
        
        neighbors = [
            {"id": 4, "name": "Security Requirements", "summary": "Security standards and requirements", "relationship": "parent"},
            {"id": 6, "name": "API Endpoints", "summary": "List of API endpoints", "relationship": "sibling"}
        ]
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("single_abstraction_optimizer")
        messages = prompt_engine.format_prompt(
            prompt,
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )
        
        response = await llm.ainvoke(messages)
        result = OptimizationResponse.model_validate_json(response.content)
        
        # Assertions - should not split this cohesive node
        # Could be empty list (no action) or single UPDATE (to improve summary)
        if len(result.optimization_decision.actions) > 0:
            assert len(result.optimization_decision.actions) == 1
            assert isinstance(result.optimization_decision.actions[0], UpdateAction)
            assert result.optimization_decision.actions[0].action == "UPDATE"
            # If updating, should maintain the cohesive nature
            assert "authentication" in result.optimization_decision.actions[0].new_summary.lower()
    
    async def test_update_poorly_summarized_node(self, llm, prompt_engine):
        """Test updating a node with poor summary/content organization"""
        # Test data - node with good content but poor summary
        node_content = """
        We implemented caching at multiple levels:
        - Redis for session data (TTL: 1 hour)
        - CDN for static assets
        - Database query caching with 5 minute TTL
        - API response caching for GET requests
        
        This reduced our average response time from 800ms to 200ms.
        """
        
        node_summary = "Some caching stuff"  # Poor summary
        node_id = 10
        node_name = "Performance Optimization"
        
        neighbors = [
            {"id": 9, "name": "System Architecture", "summary": "Overall system design", "relationship": "parent"}
        ]
        
        # Load and run prompt
        prompt = prompt_engine.load_prompt("single_abstraction_optimizer") 
        messages = prompt_engine.format_prompt(
            prompt,
            node_id=node_id,
            node_name=node_name,
            node_content=node_content,
            node_summary=node_summary,
            neighbors=neighbors
        )
        
        response = await llm.ainvoke(messages)
        result = OptimizationResponse.model_validate_json(response.content)
        
        # Assertions
        assert len(result.optimization_decision.actions) > 0
        
        # Should have exactly one UPDATE action
        assert len(result.optimization_decision.actions) == 1
        action = result.optimization_decision.actions[0]
        assert isinstance(action, UpdateAction)
        
        # Should improve the summary
        assert len(action.new_summary) > len(node_summary)
        assert "caching" in action.new_summary.lower()
        # Should mention the performance improvement
        assert any(word in action.new_summary.lower() 
                  for word in ["performance", "response", "optimization", "200ms", "speed"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py

```
"""
Test some example inputs & outputs,

e.g. TEST CASE 1: a cluttered node

a current 
  bloated node = (A,B,C,D), where the actual 
  true optimal structure is A->B, A-> C, B->D

  (b is a child of a, c is a child of a, d is a
   child of b)

  we want to keep A, and have the following 
  create actions: create(target=A, newNode(B)),
   create(target=A, newNode(C)), 
  create(target=B, newNode(D)).

  
TEST CASE 2: a node which should ideally stay as a single node
cohesive node (A1,A2,A3)

These together form an abstraction which makes more sense to be kept together, because if you split it it actualyl becomes more confusing for the user to understand.


Note, we can't determinisistically test everything, but we can test the structure of the output, that it is producing tree actions that would modify the tree as we ideally want.

"""```

-----------

## Filename: backend/tests/integration_tests/agentic_workflows/tree_action_decider/test_tree_action_decider.py

```
"""
Tests common input patterns, problems, and invariants.

THis test should test that AppendToRelevantNodeAgent + SingleAbstractionOptimiserAgent work well together, and that the overal flow with both of them gives us the output and behaviours we want.


First, some deterministic inpputs, and deterministic + fuzzy output checking:

- correctly handles WI1, WI2, WI1 case:

End up with two decisions, APPEND WI2 to existing WI2,
WI1 new node attached to WI2. (todo: specify input)


- correctly handles WI1, WI2, WI3 case
- end up with CREATE WI2 to Wi1, APPEND WI1 to existing node 1, append WI 3 to existing node 3. 

These tests will also implicitly also test the following qualities:
- Correctly favours append / create for input where one subchunk is obviously a create, one subchunk is obviously an append 
- Can correctly identify which node to append/create to in obvious case (9 nodes irrelevant, 1 node relevant)
- Actual output has atleast 10% of the words from the input.



Subjective
for the fuzzy requirements, of output being "Good" (node actions represent well), we should use an LLM judge to decide whether the test is red or green. 

- ouutput is generally correct (is a good summarry for the content)
- Title is a good summary of node content
- Summary is a good summary given input transcript 
- Node content is a good content given input transcript 
- Handles overlap correctly (overlap cases)
"""```

-----------

## Filename: backend/tests/module_tests/test_tree_action_applier_update.py

```
"""
Test UPDATE action support for TreeActionApplier
Following TDD approach - write tests first, then implementation
"""

import pytest
from unittest.mock import Mock, MagicMock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, CreateAction


class TestTreeActionApplierUpdate:
    
    @pytest.fixture
    def mock_decision_tree(self):
        """Create a mock decision tree"""
        tree = Mock()
        tree.tree = {}
        tree.get_node_id_from_name = Mock()
        tree.create_new_node = Mock()
        tree.update_node = Mock()  # New method we're testing
        return tree
    
    @pytest.fixture
    def applier(self, mock_decision_tree):
        """Create a TreeActionApplier instance"""
        return TreeActionApplier(mock_decision_tree)
    
    def test_apply_update_action(self, applier, mock_decision_tree):
        """Test applying an UPDATE action to modify node content/summary"""
        # Setup
        node_id = 5
        
        update_action = UpdateAction(
            action="UPDATE",
            node_id=node_id,
            new_content="Updated content for the node",
            new_summary="Updated concise summary"
        )
        
        # Execute - TreeActionApplier needs to handle UpdateAction
        updated_nodes = applier.apply_optimization_actions([update_action])
        
        # Verify
        mock_decision_tree.update_node.assert_called_once_with(
            node_id=node_id,
            content="Updated content for the node",
            summary="Updated concise summary"
        )
        assert updated_nodes == {node_id}
    
    def test_apply_split_as_update_plus_creates(self, applier, mock_decision_tree):
        """Test SPLIT operation as UPDATE + CREATE actions"""
        # Setup
        parent_node_id = 10
        mock_decision_tree.get_node_id_from_name.side_effect = lambda name: {
            "Parent Node": parent_node_id,
            "Child B": None,  # Doesn't exist yet
            "Child C": None   # Doesn't exist yet
        }.get(name)
        mock_decision_tree.create_new_node.side_effect = [20, 21]  # New node IDs
        
        # Actions that represent a SPLIT: UPDATE parent + CREATE children
        actions = [
            UpdateAction(
                action="UPDATE",
                node_id=parent_node_id,
                new_content="Parent content only",
                new_summary="Parent node summary"
            ),
            CreateAction(
                action="CREATE",
                target_node_name="Parent Node",
                new_node_name="Child B",
                content="Content for child B",
                summary="Child B summary",
                relationship="subtask of"
            ),
            CreateAction(
                action="CREATE",
                target_node_name="Parent Node",
                new_node_name="Child C",
                content="Content for child C",
                summary="Child C summary",
                relationship="subtask of"
            )
        ]
        
        # Execute - need unified method to handle both action types
        updated_nodes = applier.apply_mixed_actions(actions)
        
        # Verify
        # Should update parent
        mock_decision_tree.update_node.assert_called_once_with(
            node_id=parent_node_id,
            content="Parent content only",
            summary="Parent node summary"
        )
        
        # Should create two children
        assert mock_decision_tree.create_new_node.call_count == 2
        mock_decision_tree.create_new_node.assert_any_call(
            name="Child B",
            parent_node_id=parent_node_id,
            content="Content for child B",
            summary="Child B summary",
            relationship_to_parent="subtask of"
        )
        mock_decision_tree.create_new_node.assert_any_call(
            name="Child C",
            parent_node_id=parent_node_id,
            content="Content for child C",
            summary="Child C summary",
            relationship_to_parent="subtask of"
        )
        
        # Should track all updated nodes
        assert updated_nodes == {parent_node_id, 20, 21}
    
    def test_apply_multiple_update_actions(self, applier, mock_decision_tree):
        """Test applying multiple UPDATE actions"""
        # Setup
        actions = [
            UpdateAction(
                action="UPDATE",
                node_id=1,
                new_content="Updated content 1",
                new_summary="Updated summary 1"
            ),
            UpdateAction(
                action="UPDATE",
                node_id=2,
                new_content="Updated content 2",
                new_summary="Updated summary 2"
            )
        ]
        
        # Execute
        updated_nodes = applier.apply_optimization_actions(actions)
        
        # Verify
        assert mock_decision_tree.update_node.call_count == 2
        mock_decision_tree.update_node.assert_any_call(
            node_id=1,
            content="Updated content 1",
            summary="Updated summary 1"
        )
        mock_decision_tree.update_node.assert_any_call(
            node_id=2,
            content="Updated content 2",
            summary="Updated summary 2"
        )
        assert updated_nodes == {1, 2}
    
    def test_empty_actions_list(self, applier, mock_decision_tree):
        """Test handling empty actions list (no optimization needed)"""
        # Execute
        updated_nodes = applier.apply_optimization_actions([])
        
        # Verify
        mock_decision_tree.update_node.assert_not_called()
        mock_decision_tree.create_new_node.assert_not_called()
        assert updated_nodes == set()```

-----------

## Filename: backend/tests/unit_tests/test_decision_tree_ds.py

```
import unittest
from datetime import datetime, timedelta
import time
from typing import List, Dict

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node


class TestDecisionTree(unittest.TestCase):
    def test_append_to_node(self):
        dt = DecisionTree()
        node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        dt.tree[node_id].append_content("appended content", "appended_summary")
        self.assertIn("appended content", dt.tree[node_id].content)

    def test_create_new_node(self):
        dt = DecisionTree()
        new_node_id = dt.create_new_node("test_node", None, "test_content", "test_summary")
        self.assertEqual(new_node_id, 0)
        self.assertIn(0, dt.tree)
        self.assertEqual(dt.tree[0].parent_id, None)

    def test_get_recent_nodes(self):
        dt = DecisionTree()
        
        # Create some nodes
        created_nodes = []
        # Create first node with no parent
        first_node_id = dt.create_new_node("node1", None, "content1", "summary1")
        created_nodes.append(first_node_id)
        time.sleep(0.01)  # Small delay to ensure different timestamps
        
        # Create subsequent nodes with first node as parent
        for i in range(1, 3):
            node_id = dt.create_new_node(f"node{i+1}", first_node_id, f"content{i+1}", f"summary{i+1}")
            created_nodes.append(node_id)
            time.sleep(0.01)  # Small delay to ensure different timestamps
        
        # Test getting recent nodes returns a list
        recent_nodes = dt.get_recent_nodes(5)
        self.assertIsInstance(recent_nodes, list)
        
        # Test limiting the number of results
        one_node = dt.get_recent_nodes(1)
        self.assertEqual(len(one_node), 1)
        
        # Test that all created nodes appear in a sufficiently large recent nodes list
        many_nodes = dt.get_recent_nodes(20)
        for node_id in created_nodes:
            self.assertIn(node_id, many_nodes, 
                         f"Created node {node_id} should appear in recent nodes")
        
        # Test that get_recent_nodes returns valid node IDs
        for node_id in recent_nodes:
            self.assertIn(node_id, dt.tree, 
                         f"Node ID {node_id} from recent_nodes should exist in tree")

    def test_get_parent_id(self):
        dt = DecisionTree()
        node1_id = dt.create_new_node("node1", None, "content1", "summary1")
        node2_id = dt.create_new_node("node2", node1_id, "content2", "summary2")
        parent_id = dt.get_parent_id(node2_id)
        self.assertEqual(parent_id, node1_id)

    def test_get_neighbors(self):
        """Test that get_neighbors returns immediate neighbors (parent, siblings, children) with summaries"""
        dt = DecisionTree()
        
        # Create a tree structure:
        #       A
        #      / \
        #     B   C
        #    / \   \
        #   D   E   F
        
        a_id = dt.create_new_node("A", None, "Content A", "Summary A")
        b_id = dt.create_new_node("B", a_id, "Content B", "Summary B")
        c_id = dt.create_new_node("C", a_id, "Content C", "Summary C")
        d_id = dt.create_new_node("D", b_id, "Content D", "Summary D")
        e_id = dt.create_new_node("E", b_id, "Content E", "Summary E")
        f_id = dt.create_new_node("F", c_id, "Content F", "Summary F")
        
        # Test neighbors of B (should include parent A, sibling C, children D and E)
        neighbors_b = dt.get_neighbors(b_id)
        neighbor_ids = {n["id"] for n in neighbors_b}
        
        # Should have parent, sibling, and children
        self.assertEqual(len(neighbors_b), 4)
        self.assertIn(a_id, neighbor_ids)  # parent
        self.assertIn(c_id, neighbor_ids)  # sibling
        self.assertIn(d_id, neighbor_ids)  # child
        self.assertIn(e_id, neighbor_ids)  # child
        
        # Verify neighbor structure
        for neighbor in neighbors_b:
            self.assertIn("id", neighbor)
            self.assertIn("name", neighbor)
            self.assertIn("summary", neighbor)
            self.assertIn("relationship", neighbor)
            
        # Test neighbors of root node A (only children, no parent or siblings)
        neighbors_a = dt.get_neighbors(a_id)
        neighbor_ids_a = {n["id"] for n in neighbors_a}
        self.assertEqual(len(neighbors_a), 2)
        self.assertIn(b_id, neighbor_ids_a)
        self.assertIn(c_id, neighbor_ids_a)
        
        # Test neighbors of leaf node D (only parent and sibling)
        neighbors_d = dt.get_neighbors(d_id)
        neighbor_ids_d = {n["id"] for n in neighbors_d}
        self.assertEqual(len(neighbors_d), 2)
        self.assertIn(b_id, neighbor_ids_d)  # parent
        self.assertIn(e_id, neighbor_ids_d)  # sibling

    def test_update_node(self):
        """Test that update_node replaces content and summary completely"""
        dt = DecisionTree()
        
        # Create initial node
        node_id = dt.create_new_node(
            "Original Name", 
            None, 
            "Original content with lots of text", 
            "Original summary"
        )
        
        # Store original modified time
        original_modified = dt.tree[node_id].modified_at
        
        # Wait a bit to ensure time difference
        time.sleep(0.01)
        
        # Update the node
        dt.update_node(
            node_id, 
            "Completely new content", 
            "New summary"
        )
        
        # Verify content was replaced (not appended)
        self.assertEqual(dt.tree[node_id].content, "Completely new content")
        self.assertNotIn("Original content", dt.tree[node_id].content)
        
        # Verify summary was replaced
        self.assertEqual(dt.tree[node_id].summary, "New summary")
        
        # Verify name stayed the same
        self.assertEqual(dt.tree[node_id].title, "Original Name")
        
        # Verify modified time was updated
        self.assertGreater(dt.tree[node_id].modified_at, original_modified)
        
        # Test updating non-existent node raises error or returns False
        with self.assertRaises(KeyError):
            dt.update_node(999, "content", "summary")


if __name__ == "__main__":
    unittest.main()```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/agentic_TDD.md

```
A new form of TDD.

Where the first priority is defining our high level test cases. The behaviours we want our code to do.
We can work together with the agent to do this.

This is the most important step, defining what we actually want.

high level testing strategy should mostly be written by human, ask agent for clarifying questions, and to challenge & provide critique. 


To avoid bloating your own context window, 
  when there is a simple task that does not 
  require deep understanding of the whole 
  problem we are trying to solve, send this off
   to a sub agent as a sub task, so that you 
  can just review their final output, and not 
  pollute your context window with all the 
  details of the task. Don't do this for the 
  actual core implementation work unless it is 
  completely isolateable (i..e the context 
  required to do it you can copmpletely specify
   in one prompt). Do understand? Think. ask 
  clarifying questions if needed


Good for delegation (sub-agent tasks):
  - Well-defined, isolated implementations
  (like "make these specific tests pass")
  - Tasks where I can fully specify
  requirements in one prompt
  - Utility functions, simple methods,
  straightforward refactoring
  - Tasks that don't require understanding the
  broader architectural vision

  Keep in main context (do myself):
  - Core pipeline logic that requires
  understanding the overall architecture
  - Complex prompt engineering that needs
  iterative refinement
  - Integration work that touches multiple
  parts of the system
  - Strategic decisions about how components
  interact

  For example, implementing get_neighbors and
  update_node methods is perfect for delegation
   because:
  - We have clear behavioral tests defining
  exactly what they should do
  - It's isolated to the DecisionTree class
  - I can give the agent the test file and say
  "implement these methods to make the tests
  pass"


So the powerful thing here is that doing TDD allows for better use of sub agents. ```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/models.py

```
"""
Pydantic models for VoiceTree agentic workflow structured output
"""

from typing import List, Optional, Literal, Union
from pydantic import BaseModel, Field


class ChunkModel(BaseModel):
    """Model for segmentation stage output"""
    reasoning: str = Field(description="Analysis of why this is segmented as a distinct chunk and completeness assessment")
    text: str = Field(description="The actual text content of the chunk")
    is_complete: bool = Field(description="Whether this chunk represents a complete thought")


class SegmentationResponse(BaseModel):
    """Response model for segmentation stage"""
    chunks: List[ChunkModel] = Field(description="List of segmented chunks")


class RelationshipAnalysis(BaseModel):
    """Model for relationship analysis stage output"""
    name: str = Field(description="Name of the chunk being analyzed")
    text: str = Field(description="Text content of the chunk")
    reasoning: str = Field(description="Step-by-step analysis for the relationship")
    relevant_node_name: str = Field(description="Name of most relevant existing node or 'NO_RELEVANT_NODE'")
    relationship: Optional[str] = Field(description="Brief relationship description or null")


class RelationshipResponse(BaseModel):
    """Response model for relationship analysis stage"""
    analyzed_chunks: List[RelationshipAnalysis] = Field(description="Analysis results for each chunk")


class IntegrationDecision(BaseModel):
    """Model for integration decision stage output"""
    name: str = Field(description="Name of the chunk")
    text: str = Field(description="Text content of the chunk")
    reasoning: str = Field(description="Analysis that led to the integration decision")
    action: Literal["CREATE", "APPEND"] = Field(description="Whether to create new node or append to existing")
    target_node: Optional[str] = Field(description="Target node for the action")
    new_node_name: Optional[str] = Field(description="Name for new node if action is CREATE")
    new_node_summary: Optional[str] = Field(description="Summary for new node if action is CREATE")
    relationship_for_edge: Optional[str] = Field(description="Relationship description for new edges")
    content: str = Field(description="Content to add to the node")


class IntegrationResponse(BaseModel):
    """Response model for integration decision stage"""
    integration_decisions: List[IntegrationDecision] = Field(description="Integration decisions for each chunk")


class NodeSummary(BaseModel):
    """Summary information about a node for neighbor context"""
    id: int = Field(description="Node ID")
    name: str = Field(description="Node name")
    summary: str = Field(description="Node summary")
    relationship: str = Field(description="Relationship to the target node (parent/sibling/child)")


class UpdateAction(BaseModel):
    """Model for UPDATE tree action"""
    action: Literal["UPDATE"] = Field(description="Action type")
    node_id: int = Field(description="ID of node to update")
    new_content: str = Field(description="New content to replace existing content")
    new_summary: str = Field(description="New summary to replace existing summary")


class CreateAction(BaseModel):
    """Model for CREATE action in optimization context"""
    action: Literal["CREATE"] = Field(description="Action type")
    target_node_name: str = Field(description="Name of parent node")
    new_node_name: str = Field(description="Name for the new node")
    content: str = Field(description="Content for the new node")
    summary: str = Field(description="Summary for the new node")
    relationship: str = Field(description="Relationship to parent (e.g., 'subtask of')")


class OptimizationDecision(BaseModel):
    """Model for single abstraction optimization output"""
    reasoning: str = Field(description="Analysis that led to the optimization decision")
    actions: List[Union[UpdateAction, CreateAction]] = Field(
        description="List of actions to take (can be empty if no optimization needed)",
        default_factory=list
    )


class OptimizationResponse(BaseModel):
    """Response model for single abstraction optimization stage"""
    optimization_decision: OptimizationDecision = Field(description="The optimization decision")


class TargetNodeIdentification(BaseModel):
    """Model for identifying target node for a segment"""
    text: str = Field(description="Text content of the segment")
    reasoning: str = Field(description="Analysis for choosing the target node")
    target_node_name: str = Field(description="Name of target node (existing or hypothetical new node)")
    is_new_node: bool = Field(description="Whether this is a new node to be created")


class TargetNodeResponse(BaseModel):
    """Response model for identify target node stage"""
    target_nodes: List[TargetNodeIdentification] = Field(description="Target node for each segment") ```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_claude.md

```

Original task:

I want to improve my agentic workflow for 
  converting text chunk into tree update 
  actions 


  ALl the existing code for doing that is 
  stored in @backend/text_to_graph_pipeline/ 
  predominantly 
  @backend/text_to_graph_pipeline/agentic_workf
  lows/agents/tree_action_decider_agent.py 


  I have new insights into the core algorithm /
   pipeline for doing this.

  Here they are, background: 
  @backend/text_to_graph_pipeline/agentic_workf
  lows/VoiceTree_Math.md 

  THe pipeline to address this 
  @backend/text_to_graph_pipeline/agentic_workf
  lows/new_pipeline.md 


  Let's create a plan for the steps required to
   change our current pipeline, to the new 
  pipeline.

  We should be able to re-use the current 
  segmentation.md prompt with changes (e.g. 
  don't create titles yet)

  Relationship_analysis.md prompt will become 
  the identify_target_node.md prompt

  And then we will need some new logic to do 
  the single abstraction optimiser approach, 
  since it requires knowing which nodes were 
  modified in the last iteration, tree method 
  to get neighbouring nodes. and then new 
  support for UPDATE tree action. 

  Get all the context you need, ask clarifying 
  questions, and ultrathink so that we can 
  write an excellent plan for engineering this 
  new workflow/pipeline :D

YOUR TASK:
previous engineer's plannign document: 
@backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan.md
They have been tracking their progress here as well. this includes some clarifications I provided. Your task is to continue working on this project.

TDD:
Let's try follow TDD for executing this, 
  since this is quite complex.


SUB AGENT USAGE:
To avoid bloating your own context window, 
  when there is a simple task that does not 
  require deep understanding of the whole 
  problem we are trying to solve, send this off
   to a sub agent as a sub task, so that you 
  can just review their final output, and not 
  pollute your context window with all the 
  details of the task. Don't do this for the 
  actual core implementation work unless it is 
  completely isolateable (i..e the context 
  required to do it you can copmpletely specify
   in one prompt). Do understand? Think. ask 
  clarifying questions if needed


The engineer noted the following heurisitc:

Good for delegation (sub-agent tasks):
  - Well-defined, isolated implementations
  (like "make these specific tests pass")
  - Tasks where I can fully specify
  requirements in one prompt
  - Utility functions, simple methods,
  straightforward refactoring
  - Tasks that don't require understanding the
  broader architectural vision

  Keep in main context (do myself):
  - Core pipeline logic that requires
  understanding the overall architecture
  - Complex prompt engineering that needs
  iterative refinement
  - Integration work that touches multiple
  parts of the system
  - Strategic decisions about how components
  interact

So the powerful thing here is that doing TDD allows for better use of sub agents. 

Gather all your context to understand this task, Ask any clarifying questions you need.```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/new_pipeline_implementation_plan.md

```
# VoiceTree New Pipeline Implementation Plan

## Overview
Transition from current 3-stage pipeline to new 4-stage pipeline with optimization focus.

## Context for Next Engineer (Phase 3-4)

### What's Already Built
- **Infrastructure**: DecisionTree methods (`get_neighbors`, `update_node`) and TreeActionApplier (`apply_optimization_actions`, `apply_mixed_actions`) 
- **Models**: `UpdateAction`, `CreateAction`, `OptimizationDecision` returning list of actions
- **Prompts**: All 3 prompts created and tested (`segmentation.md`, `identify_target_node.md`, `single_abstraction_optimizer.md`)

### Agent Architecture Pattern
This codebase uses a specific LangGraph pattern (see `backend/text_to_graph_pipeline/agentic_workflows/core/agent.py`):
- Agents inherit from base `Agent` class
- Use `add_prompt()` to register prompts with structured output models
- Use `add_dataflow()` to define pipeline flow
- Prompts auto-load from `prompts/` directory

### Critical Implementation Notes
1. **Node Name Resolution**: The optimizer outputs node names, but TreeActionApplier needs IDs. Use `decision_tree.get_node_id_from_name()`
2. **Modified Node Tracking**: Stage 3 must output node IDs that were modified for Stage 4 to process
3. **SPLIT = UPDATE + CREATE**: Never a separate action. Optimizer returns list: `[UpdateAction(parent), CreateAction(child1), CreateAction(child2), ...]`
4. **Current Agent Rename**: Existing `TreeActionDeciderAgent` becomes `AppendToRelevantNodeAgent` (stages 1-3 only)

## Pipeline Stages

### Stage 1: Segmentation (Modified)
- Remove title generation from chunks
- Keep atomic idea extraction and completeness detection
- Output: segments without names

### Stage 2: Identify Target Node (New)
- For each segment, find most relevant existing node
- If no relevant node, create hypothetical node name immediately
- Output: segment → target node mapping

### Stage 3: Append Content
- Append each segment to its identified target node
- Track which nodes were modified
- Output: list of modified node IDs

### Stage 4: Single Abstraction Optimization (New)
- For each modified node:
  - Input: node content, summary, immediate neighbors (summaries only)
  - Apply optimization techniques from VoiceTree_Math.md
  - Output: UPDATE or SPLIT actions

## New Tree Actions

### UPDATE Action
```python
class UpdateAction:
    action: Literal["UPDATE"] 
    node_id: int
    new_content: str
    new_summary: str
```

### SPLIT Implementation
SPLIT is not a separate action type. It's implemented as:
1. UPDATE the original node to contain only parent content
2. CREATE new child nodes

The optimizer returns a list of actions that can include multiple CREATE and UPDATE actions to achieve the split.

## Implementation Steps
We will be following TDD for this project. A slightly different take on TDD where initially we just want a high level test, that doesn't go into any detail, just tests input -> expected output (behaviour) at whatever level of abstraction we are working on (method, module, prompt, agent, etc.)

### Phase 1: Core Infrastructure

0. Write high level behavioural tests for get_neighbours & update_node, focused on outcomme/behaviours not implementation details. 

1. Add UPDATE/SPLIT to models.py
2. Implement DecisionTree methods:
   - `get_neighbors(node_id) -> List[NodeSummary]`
   - `update_node(node_id, content, summary)`
   - Handle SPLIT in TreeActionApplier (create nodes first, then relationships)

Progress notes:
- Commit 4c20a15: Added behavioral tests for get_neighbors() and update_node() methods in test_decision_tree_ds.py
- Commit 4c20a15: Added new tree action models (UPDATE, SPLIT) and pipeline stage models to models.py
- Commit 4c20a15: Removed name field from ChunkModel to align with new segmentation approach
- Commit 74a98ff: Implemented get_neighbors() and update_node() methods in DecisionTree class (delegated to sub-agent)

### Phase 2: Prompts
0. Create input/fuzzy(output) test cases for the each of the prompts:
see backend/tests/integration_tests/agentic_workflows/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py
0. Segmentation prompt test can be skipped for now since we know it works well and we aren't modifying it much
0. Identify target node, simple input/output test just for sanity check
Note these tests should actually call the LLM. 

1. Modify segmentation.md (remove name field)
2. Create identify_target_node.md (simplified relationship_analysis)
3. Create single_abstraction_optimizer.md (with techniques from math doc)

Progress notes:
- Commit e6b4db2: Created test cases for identify_target_node and single_abstraction_optimizer prompts
- Commit e6b4db2: Modified segmentation.md to remove name field (delegated to sub-agent)
- Commit e6b4db2: Created identify_target_node.md prompt (delegated to sub-agent)
- Commit e6b4db2: Created single_abstraction_optimizer.md incorporating VoiceTree_Math optimization techniques

### Phase 2.5: TreeActionApplier Updates
0. Write behavioral tests for TreeActionApplier UPDATE support
1. Update models to allow optimizer to return multiple actions (for SPLIT = UPDATE + CREATEs)
2. Implement UPDATE action support in TreeActionApplier

Progress notes:
- Commit e53411f: Fixed model mismatch - created CreateAction model for optimizer output
- Commit e53411f: Updated prompts and tests to use CreateAction instead of IntegrationDecision
- Commit e53411f: Wrote tests for TreeActionApplier UPDATE support (not passing yet)
- Commit 4865fa3: Implemented UPDATE action support in TreeActionApplier - all tests pass

### Phase 3: Agents

#### What Needs to Be Done
1. **Create SingleAbstractionOptimizerAgent** (new file)
   - Single prompt agent using `single_abstraction_optimizer.md`
   - Input: node_id, node content/summary, neighbors
   - Output: `OptimizationResponse` with list of actions

2. **Rename & Refactor Current Agent**
   - Copy `tree_action_decider_agent.py` → `append_to_relevant_node_agent.py`
   - Remove `integration_decision` stage
   - Replace `relationship_analysis` → `identify_target` (using new prompt)
   - Output modified node IDs after append stage

3. **Create New TreeActionDeciderAgent** (wrapper)
   - Runs AppendToRelevantNodeAgent first
   - Takes modified node IDs and runs SingleAbstractionOptimizerAgent on each
   - Combines all actions and applies via TreeActionApplier

#### State Management Between Stages
```python
# Stage 3 output needs to include:
state["modified_node_ids"] = [1, 5, 7]  # IDs of nodes that had content appended

# Stage 4 processes each:
for node_id in state["modified_node_ids"]:
    # Run optimizer on this node
```

### Phase 4: Integration
0. Integration test, update our existing integration test backend/tests/integration_tests/chunk_processing_pipeline/test_pipeline_e2e_with_di.py, this is our E2E test for our system with the agent part (TreeActionDeciderAgent) mocked. 
1. Update workflow adapter
2. Add tests for new actions
3. Run benchmarker

## Key Design Decisions

- UPDATE replaces entire node content/summary
- SPLIT is not a separate action - it's UPDATE + CREATE actions
- Optimizer can return multiple actions (list) to handle complex operations
- Optimization uses immediate neighbors only (for now)
- Modified nodes tracked at node ID level

## Quick Reference for Implementation

### Example Files to Study
- **Agent Pattern**: `backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py`
- **State Definition**: `backend/text_to_graph_pipeline/agentic_workflows/core/state.py` 
- **Models**: `backend/text_to_graph_pipeline/agentic_workflows/models.py`
- **TreeActionApplier Usage**: `backend/text_to_graph_pipeline/chunk_processing_pipeline/chunk_processor.py`

### Key Methods You'll Use
```python
# Getting neighbors for optimizer
neighbors = decision_tree.get_neighbors(node_id)  # Returns List[Dict] with id, name, summary, relationship

# Applying optimizer actions
applier = TreeActionApplier(decision_tree)
updated_nodes = applier.apply_mixed_actions(actions)  # For UPDATE + CREATE combos
```

### Common Gotchas to Avoid
1. **State Updates**: The VoiceTreeState is a TypedDict - you must include ALL fields when updating
2. **Prompt Loading**: Prompts must be in `prompts/` directory with exact filename matching prompt name
3. **Model Validation**: OptimizationResponse expects `optimization_decision.actions` to be a list (can be empty)
4. **Node Resolution**: Always convert node names to IDs before passing to TreeActionApplier```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/new_pipeline.md

```

1. Segment to atomic idea / units of thought
2. For each segment identify most relevant node, or if no relevant node, a new  node (LLM answer Q: what would a hypothetical most relevant node be called)
3. Append to that Node
-----------
4. For each modified node, run sinle_abstraction_optimsation prompt. Which attempts to solve [[backend/text_to_graph_pipeline/agentic_workflows/VoiceTree_Math.md]] with different [[backend/text_to_graph_pipeline/agentic_workflows/single_abstraction_optimiser_approach.md]] 
	1. It can return the following TreeActions: 
		1. split (break node into multiple nodes, with relationships defined between them). ```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/prompts/identify_target_node.md

```
You are an expert system component responsible for identifying which existing node each text segment should be appended to, or proposing a new node name if no suitable node exists.

Your task is to analyze a list of text segments and, for each one, identify the single most relevant existing node to append it to OR propose a hypothetical new node name if no suitable node exists.

Your specific instructions are:

1. Iterate through each segment in the `segments` list. Each segment contains `text` field.

2. For each segment:
   a. Analyze the core meaning and topic presented in its `text`.
   b. Carefully compare this core meaning against the `name` and `summary` of *every* node provided in the `existing_nodes`.
   c. Determine which existing node is the most semantically relevant to append this segment to.
   d. If no existing node is sufficiently relevant (the segment represents a new topic or concept), propose a clear, descriptive name for a new node.

3. Use the "reasoning" field to explain your thought process:
   - First, understand what the segment is trying to say
   - Identify the main topic or concept
   - Explain why you chose the target node OR why a new node is needed
   - For new nodes, explain why the proposed name is appropriate

**Output Format:** Construct a JSON object with a "target_nodes" field containing a list. Each element in the list corresponds to one input segment and MUST contain ALL of the following fields:
   * `text`: The original text of the segment from the input (required, string).
   * `reasoning`: Your analysis for choosing the target node (required, string).
   * `target_node_name`: The exact `name` of the chosen existing node OR a proposed name for a new node (required, string).
   * `is_new_node`: Boolean indicating whether this is a new node (true) or existing node (false) (required, boolean).

Ensure that EVERY element in "target_nodes" contains ALL four fields listed above. Missing any field will cause validation errors. Ensure your final output is ONLY the valid JSON object described above.

**Example:**

**Existing Nodes:** `[{"name": "Project Setup", "summary": "Initial project configuration and requirements gathering"}, {"name": "Database Architecture", "summary": "Database design patterns and technology selection criteria"}]`

**Segments:** `[{"text": "We decided to use PostgreSQL for better performance with complex queries"}, {"text": "The authentication system will use JWT tokens with refresh token rotation"}, {"text": "For our PostgreSQL setup, we need to tune the query planner settings"}]`

**Expected Output:**
```json
{
  "target_nodes": [
    {
      "text": "We decided to use PostgreSQL for better performance with complex queries",
      "reasoning": "This segment discusses the selection of PostgreSQL as the database technology. This directly relates to database design decisions and technology choices, making it most relevant to the Database Architecture node.",
      "target_node_name": "Database Architecture",
      "is_new_node": false
    },
    {
      "text": "The authentication system will use JWT tokens with refresh token rotation",
      "reasoning": "This segment describes authentication implementation details. None of the existing nodes cover authentication or security topics, so a new node is needed to capture this distinct concept.",
      "target_node_name": "Authentication System",
      "is_new_node": true
    },
    {
      "text": "For our PostgreSQL setup, we need to tune the query planner settings",
      "reasoning": "This segment provides specific configuration details for PostgreSQL. It's directly related to database implementation and belongs with other database-related content in the Database Architecture node.",
      "target_node_name": "Database Architecture",
      "is_new_node": false
    }
  ]
}
```

**Input Data:**

**Existing Nodes:**
{{existing_nodes}}

**Segments to Analyze:**
{{segments}}```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/prompts/segmentation.md

```
You are an expert at segmenting voice transcripts into atomic ideas (complete thoughts) for a knowledge/task graph. 
The voice transcript may also contain unfinished content, so you should also identify unfnished sentences.

INPUT VARIABLES:
- transcript_history: Recent transcript history (the last ~250 chars before transcript_text), use this to understand the following transcript_text within the speakers's context
- transcript_text: The voice transcript to segment

OUTPUT FORMAT:
```json
{
  "chunks": [
    {"reasoning": "Analysis of why this is segmented as a distinct chunk and completeness assessment", "text": "The actual text...", "is_complete": true/false}
  ]
}
```

SEGMENTATION PROCESS:
For each potential chunk, FIRST use the `reasoning` field as brainstorming section to analyze:
- Try understand the actual meaning of the content within the context
- Consider existing nodes in the graph to understand established concepts and terminology
- Where are the natural boundaries between distinct ideas or work-items (problems, solutions, questions)?
- What parts are likely be unfinished?

THEN apply these segmentation rules based on your reasoning:

1. **One idea per chunk** - Each chunk must be a complete, self-contained thought that can stand alone as a knowledge node.

2. **Split on topic shifts** - New chunk when:
   - New topic, task, or requirement
   - Different example or anecdote  
   - Question or answer
   - Clear transition words ("also", "next", "another thing")

3. **Keep together** - Don't split:
   - Dependent clauses that explain the main idea
   - Context needed to understand the point
   - Short filler words with their content ("Um, I need to..." stays together)
   - It is fine to only return a single chunk in your final output.

4. **Completeness check** - For EVERY chunk:
   - `is_complete: false` if it ends mid-sentence or doesn't yet make sense within the context (e.g., "So, that's going to be something that", "And then we will build")
   - `is_complete: true` if it's a complete thought
   - When unsure, mark incomplete - better to wait for more context

5. **Light editing** - Our voice to text transcription may have mistakes. First try understand the intended meaning of the text within the context (transcript history), then fix these common errors such that the output text represent the intended meaning with minimal changes:
   - Accidentally repeated words: "may  may be caausing" → "may be causing"
   - Wrong homophones in context: "there" vs "their", "to" vs "too"
   - Missing words: Add only if obvious from context (e.g., "I working on" → "I'm working on")
   - Likely hallucinations and filler words ("um", "you know", etc.)
   - Grammar: Minimum changes to improve grammar, but retain the intended meaning.
   - Preserve: Speaker's natural style, intentional repetition, emphasis

EXAMPLES:

transcript_text: "So, today I'm starting work on voice tree. Right now, there's a few different things I want to look into. The first thing is I want to make a proof of concept of voice tree. So, the bare"

Output:
```json
{
  "chunks": [
    {"reasoning": "This introduces the main topic (voice tree project) and sets up context about exploring different aspects. It's a complete thought that stands alone.", "text": "So, today I'm starting work on voice tree. Right now, there's a few different things I want to look into.", "is_complete": true},
    {"reasoning": "This shifts to a specific task - creating a proof of concept. It's a distinct action item separate from the general introduction, forming its own complete thought.", "text": "The first thing is I want to make a proof of concept of voice tree.", "is_complete": true},
    {"reasoning": "This segment cuts off mid-sentence after 'bare', clearly incomplete. Waiting for more context to understand what aspect of the proof of concept is being discussed.", "text": "So, the bare", "is_complete": false}
  ]
}
```

transcript_text: "I need to look into visualization libraries. Uh, converting text into a data format. But that's later."

Output:
```json
{
  "chunks": [
    {"reasoning": "This is a distinct task about researching visualization libraries. It's a complete, self-contained thought.", "text": "I need to look into visualization libraries.", "is_complete": true},
    {"reasoning": "this could be introducing a separate task about data format conversion. It's grammatically informal but arguably conceptually complete. Since it is borderline, let's default to waiting for more input later to see if the meaning changes", "text": "converting text into a data format.", "is_complete": false},
    {"reasoning": "This seems to be referring back to the same task about researching visualization libraries. It's a complete thought.", "text": "Oh yea, Myles mentioned Mermaid as a good visualization option", "is_complete": true},
  ]
}
```
────────────────────────────────────────
EXISTING NODES (for context awareness):
────────────────────────────────────────
{{existing_nodes}}

────────────────────────────────────────
RECENT CONTEXT (if available):
────────────────────────────────────────
{{transcript_history}}

────────────────────────────────────────
TRANSCRIPT TO SEGMENT:
────────────────────────────────────────
{{transcript_text}}```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/prompts/single_abstraction_optimizer.md

```
You are an expert system component responsible for optimizing the abstraction level of individual nodes in a knowledge tree. Your goal is to minimize the human computation required to understand the original meaning at the necessary level of abstraction.

## Core Optimization Principle

You are solving a compression problem: Given a node's content, find the optimal structure that minimizes (Structure Length + Cognitive Fidelity Loss).

A well-structured tree allows users to hold 5-8 items in working memory while reasoning about relationships. Each node should represent a cohesive "work item" - a task, decision, problem, question, solution, counter-example, answer, or concept description.

## Input Variables
- node_id: The ID of the node being optimized
- node_name: Current name of the node
- node_content: Full text content of the node
- node_summary: Current summary of the node
- neighbors: List of immediate neighbors with {id, name, summary, relationship}

## Analysis Techniques

### 1. The Abstraction Test (Compressibility)
Can you create a concise title (3-7 words) that accurately encapsulates all content? If not, the node likely needs splitting.

### 2. Semantic Entropy Analysis
Identify distinct semantic themes within the node. High entropy (multiple unrelated topics) indicates need for splitting.

### 3. Structural Pattern Recognition
Look for common patterns that suggest natural splits:
- Problem/Solution Pattern: Problem as parent, solutions as children
- Goal/Steps Pattern: High-level goal as parent, tasks as children  
- Claim/Evidence Pattern: Insight as parent, observations as children

### 4. Work Item Coherence
Each node should represent a single "work item" that could stand alone as a ticket in a project management system.

## Decision Process

1. **Analyze Current State**
   - Identify all semantic themes/abstractions in the content
   - Assess coherence - do all parts relate to a single work item?
   - Check if current summary accurately represents all content

2. **Determine Optimal Structure**
   - If content is cohesive around single abstraction → Keep as is or UPDATE
   - If multiple distinct abstractions exist → SPLIT into coherent work items
   - If summary/content is poorly organized → UPDATE with better structure

3. **For SPLIT Actions**
   - Keep the highest-level abstraction as the parent node
   - Create child nodes for each distinct sub-abstraction
   - Ensure each new node passes the abstraction test
   - Define clear parent-child relationships

## Output Format

```json
{
  "optimization_decision": {
    "reasoning": "Detailed analysis of the node's current state and why the chosen actions optimize its abstraction level",
    "actions": [<list_of_actions>]
  }
}
```

Where actions is a list that can contain:

### UPDATE Action:
```json
{
  "action": "UPDATE",
  "node_id": <node_id>,
  "new_content": "Reorganized or clarified content",
  "new_summary": "Improved summary that accurately represents the content"
}
```

### CREATE Action (for splitting):
```json
{
  "action": "CREATE",
  "target_node_name": "Parent Node Name",
  "new_node_name": "Child Node Name",
  "content": "Content for this child node",
  "summary": "Summary of this child's content",
  "relationship": "Relationship to parent (e.g., 'subtask of', 'implements', 'solves')"
}
```

### No Action:
```json
{
  "optimization_decision": {
    "reasoning": "Analysis showing why no optimization is needed",
    "actions": []
  }
}
```

Note: SPLIT operations are implemented as one UPDATE action (to update the parent) followed by multiple CREATE actions (for the children).

## Examples

### Example 1: Node Requiring SPLIT

**Input:**
```
node_id: 5
node_name: "System Setup"
node_content: "We need to configure the development environment with Node.js and npm. The database will use PostgreSQL with specific performance tuning. Frontend deployment requires setting up CI/CD pipeline with GitHub Actions. User authentication will implement OAuth2 with Google and GitHub providers."
node_summary: "System setup and configuration tasks"
neighbors: [{"id": 4, "name": "Project Planning", "summary": "High-level project goals", "relationship": "sibling"}]
```

**Output:**
```json
{
  "optimization_decision": {
    "reasoning": "This node contains four distinct work items: environment setup, database configuration, deployment pipeline, and authentication setup. Each represents a separate task that would be tracked independently. Splitting improves clarity and allows focused work on each area. The current node name 'System Setup' serves well as a parent abstraction.",
    "actions": [
      {
        "action": "UPDATE",
        "node_id": 5,
        "new_content": "System setup encompasses development environment, database configuration, deployment pipeline, and authentication setup.",
        "new_summary": "High-level system setup and configuration tasks"
      },
      {
        "action": "CREATE",
        "target_node_name": "System Setup",
        "new_node_name": "Development Environment",
        "content": "Configure the development environment with Node.js and npm",
        "summary": "Node.js development environment setup",
        "relationship": "subtask of"
      },
      {
        "action": "CREATE",
        "target_node_name": "System Setup",
        "new_node_name": "Database Configuration",
        "content": "PostgreSQL setup with specific performance tuning",
        "summary": "PostgreSQL database setup and optimization",
        "relationship": "subtask of"
      },
      {
        "action": "CREATE",
        "target_node_name": "System Setup",
        "new_node_name": "CI/CD Pipeline",
        "content": "Frontend deployment using GitHub Actions CI/CD pipeline",
        "summary": "Automated deployment pipeline configuration",
        "relationship": "subtask of"
      },
      {
        "action": "CREATE",
        "target_node_name": "System Setup",
        "new_node_name": "OAuth2 Authentication",
        "content": "Implement OAuth2 authentication with Google and GitHub providers",
        "summary": "OAuth2 setup for user authentication",
        "relationship": "subtask of"
      }
    ]
  }
}
```

### Example 2: Cohesive Node (No Action Needed)

**Input:**
```
node_id: 12
node_name: "Cache Implementation Strategy"
node_content: "Implement multi-level caching: Redis for session data with 1-hour TTL, CDN for static assets, database query caching with 5-minute TTL, and API response caching for GET requests. This integrated approach reduced response times from 800ms to 200ms."
node_summary: "Multi-level caching strategy reducing response time by 75%"
neighbors: [{"id": 11, "name": "Performance Optimization", "summary": "System performance improvements", "relationship": "parent"}]
```

**Output:**
```json
{
  "optimization_decision": {
    "reasoning": "This node represents a single cohesive work item - implementing a caching strategy. All content relates to the same abstraction (caching), with different cache types serving the unified goal of performance improvement. The summary accurately captures both the approach and impact. Splitting would fragment a coherent solution.",
    "actions": []
  }
}
```

### Example 3: Node Needing UPDATE

**Input:**
```
node_id: 8
node_name: "API Design"
node_content: "REST endpoints: GET /users, POST /users, GET /users/:id. We decided to use JWT tokens. The tokens expire after 24 hours. Also need to handle CORS for the frontend. Response format will be JSON with consistent error structure."
node_summary: "API stuff"
neighbors: [{"id": 7, "name": "Backend Architecture", "summary": "Server-side design decisions", "relationship": "parent"}]
```

**Output:**
```json
{
  "optimization_decision": {
    "reasoning": "The content is cohesive around API design but poorly organized and the summary is inadequate. The content mixes endpoint definitions, authentication, and response format decisions. Reorganizing with a better structure and comprehensive summary improves clarity without splitting.",
    "actions": [
      {
        "action": "UPDATE",
        "node_id": 8,
        "new_content": "REST API Design:\n\nEndpoints:\n- GET /users - List all users\n- POST /users - Create new user\n- GET /users/:id - Get specific user\n\nAuthentication:\n- JWT tokens with 24-hour expiration\n\nResponse Format:\n- JSON with consistent error structure\n- CORS enabled for frontend access",
        "new_summary": "REST API design with user endpoints, JWT authentication, and JSON response format"
      }
    ]
  }
}
```

---

Remember: The goal is to create nodes that represent the abstractions used in problem-solving, where each node is a meaningful unit of work that can be reasoned about independently while maintaining clear relationships to related concepts.```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/single_abstraction_optimiser_approach.md

```
Techniques the 

	1. classification of components of a node into different types/abstractions such as:
(In other words, identify the abstractions present)

    - Task, Decision, Problem, Question, Solution (or possible solution), counter example, answer, description of a function or abstraction, insight, observation 
(list may not be exhaustive)

	2. Fill in the blank to identify relationship type between abstractions here.

	3. Awareness of the optimisation problem we are trying to solve (actually include this in the prompt), essentially give it [[VoiceTree_Math.md]] and tell it just solve the optimisation problem.

    4. Include tools to solve the optimisation problem:
        - The abstraction test, compressability, entropy test, common patterns:


#### **Technique A: The Abstraction Test (Compressibility)**

This is the most fundamental technique, directly from our earlier discussions.

- **Concept:** A good node structure represents a successful compression of information. A good node title is the "key" to that compression.
    
- **Implementation:** After proposing a new structure (e.g., splitting one node into a parent and two children), prompt the integrator: **"For each new parent node you created, provide a short, descriptive title (3-7 words) that accurately encapsulates all of its children. If you cannot create a concise and accurate title, the abstraction is likely incorrect"**
    

#### **Technique B: Structural Pattern Matching**

Human thought and projects follow recurring patterns. The integrator can be trained to recognize and enforce these patterns.

- **Concept:** Many nodes are not just random collections of thoughts; they follow logical narrative structures.
    
- **Implementation:** Prompt the integrator to identify common patterns in the combined node + inbox content.
    
    - **Problem/Solution Pattern:** "Does this content describe a Problem and a corresponding Solution or Task? If so, structure it with the Problem as the parent and the Solution/Task as the child."
        
    - **Goal/Steps Pattern:** "Does this content describe a high-level Goal and a sequence of Tasks to achieve it? If so, structure it that way."
        
    - **Claim/Evidence Pattern:** "Does this content make a Claim or Insight and then provide several Observations as evidence? If so, group the Observations under the Insight."
        
- **Example:** An inbox with "The login is slow" (Problem) and "We need to add a DB index" (Task) should be automatically structured into a parent-child relationship.
    

#### **Technique C: Semantic Entropy Reduction**

This is a more advanced way of thinking about the "junk drawer" problem.

- **Concept:** "Entropy" here means the degree of topical disorder within a node. A node with 5 different unrelated topics has high entropy. The integrator's job is to create a new structure that minimizes the entropy of each resulting node, and the entropy of the stucture of the abstracted tree view: nodes and their relationships between them.
    
- **Implementation:** Prompt the integrator: **"Analyze all the text fragments within this node. Identify the core semantic themes. Is there one theme or multiple? If there are multiple distinct themes, propose a split that groups all fragments related to Theme A into one node and all fragments for Theme B into another."**
    
- **Example:** A node Notes from Meeting contains text about UI redesign, database performance, and Q4 hiring. This has high entropy. The integrator should propose splitting it into three separate, low-entropy nodes, each focused on one topic.


The cool thing about entropy approach is that it can create synthetic nodes just for groupings that weren't explicit, but can be implicitly inferred, and if so decrease the entropy / improve the understandability a lot. 
    

#### **Technique D: The "Why" Prompt (Metacognition)**

For debugging and improving the system, force the integrator to explain its reasoning.

- **Concept:** Making the LLM's reasoning explicit allows you to understand its "thought process" and refine the prompt.
    
- **Implementation:** For every structural change it proposes (a split or merge), require it to output a justification field.



APPROACH

Input:
Node content,

For enhanced understanding of context the node fits into:
- neighbouring nodes, their summaries, and relationship to input node.
- (LATER) Perhaps the n=5 stick of parents of the node, i.e. parent(parent(parent(node)))...

 
Output:
Udated content of the node
Updated summary of the node
(tree UPDATE actions)
New nodes & their relationship to existing nodes. (tree CREATE actions)
```

-----------

## Filename: backend/text_to_graph_pipeline/agentic_workflows/VoiceTree_Math.md

```
### **1. Core Objective of the System**

The primary function of our system is to generate a tree structure that optimally represents the meaning and organization of a conversation in near real-time (allowing for a ~15-second lag). The goal is to provide the user with a compressed, structural representation of their work, thereby enhancing their ability to reason about it.

### **2. The Core Pipeline Function**

Our development pipeline must solve the following core task: given an existing tree and 1-5 new sentences of content, it must produce the best possible updated tree that incorporates and represents the new meaning.

f(existing_tree, new_content) => best_possible_updated_tree

The central challenge is defining and implementing the "best possible update." This requires breaking down specific examples of updates, generalizing them, and translating those generalizations into code. Our framework for this is a "work-item-tree," where we either append new content to an existing work item or create a new one.

### **3. The "Work Item" Framework**

A "work item" is the fundamental unit of our tree. It is an abstraction that can represent any of the following:

- Task
    
- Decision
    
- Problem
    
- Question
    
- Solution (or potential solution)
    
- Counter-example
    
- Answer
    
- Description of a function or concept
    

Think of a work item as anything that could be a ticket or sub-task in a system like Jira. Each work item contains its own state, context, and details.

This concept is based on the observation that when manually creating voice notes, nearly every node corresponds to one of these items. For conversational elements that don't fit neatly (e.g., chit-chat at the start of a meeting), we can create "ghost" work-item nodes by inferring the underlying intent, such as "building rapport."

### **4. The Central Question: Granularity**

This leads to the most important question for our system: **When is a piece of information worthy of becoming its own work item?** In other words, at what granularity should we extract work items from a given chunk of text?

The answer to this question gets to the very root of why this system is useful.

### **5. Key Insight: The System as a Compression Algorithm**

The task of our system is fundamentally about **compression**. Given a stream of text, how can we best break it down into a set of abstractions with relationships, such that the high-level meaning is presented with maximum compression?

This framing reveals that our core challenge is an **optimization problem**.

### **6. Formulating the Optimization Problem**

We want to find a tree structure that minimizes a combination of competing factors.

**Initial Formulation:** Minimize (Structure Length + Meaning Loss)

These two variables are in direct opposition:

- **A single mega-node:** This yields a minimum structure length but causes a high loss of structural meaning.
    
- **Maximum fragmentation (e.g., one node per noun):** This results in a very high structure length. While it might seem to have no meaning loss, it actually introduces **understandability loss**—a graph of every noun is less comprehensible to a human than the original sentence.
    

**Refined Formulation:** Minimize (Structure Length + Meaning Loss + Understandability Loss)

We can simplify this by recognizing that "Meaning Loss" and "Understandability Loss" are deeply related. Let's call their combination **"Cognitive Fidelity Loss"**.

Furthermore, the reason we want a short structure length is to increase the speed and ease of understanding. Therefore, all factors can be unified into a single objective:

**Unified Objective:** Minimize the human computation required to understand the original meaning at the necessary level of abstraction.

### **7. Clarification on "Meaning Loss"**

It is critical to note that some loss of detail at the high-level, structural view is not only acceptable but **desirable**. This is abstraction, not omission. The user can always click on a specific node to access all the detailed text associated with it. The optimization, therefore, seeks the ideal middle ground between a completely flat structure and an overly fragmented one.

### **8. The Guiding Principle: Aligning with Human Cognition**

The ultimate goal is to create an abstracted view that operates at the user's **currently required working level of abstraction.**

A human engaged in problem-solving can only hold a few items (perhaps 5-8) in their working memory at once. They reason about how these "items" relate to each other. **The nodes in our tree should represent these same cognitive items.**

This is the level we must optimize for. Our system should aim to recreate the abstractions being used in the problem-solving and decision-making centers of the brain. Even more powerfully, since a human brain often doesn't use the most optimal abstractions, **our system has the opportunity to provide a better, clearer set of abstractions, thereby actively improving the user's problem-solving process.**

 However this  raises a critical dichotomy:

- **Mirroring:** Replicating the abstractions the user's brain is currently using.
    
- **Optimizing:** Providing the abstractions that are objectively optimal for solving the problem.

a choice about the system's fundamental role. Is it a perfect scribe or an expert cognitive coach?

Answer: we are more mostly mirroring the abstractions the user has expressed in their spoken content, however we will make minor adjustments if they greatly improve the compression.

The system's goal is to maintain a state of low "Structural Tension." (or entropy) It defaults to mirroring the user's mind, but gently nudges them toward a more organized cognitive state whenever it detects that the mental model is becoming costly or inefficient. It helps the user not only to solve the problem at hand, but to become a clearer thinker.```

-----------

## Filename: backend/text_to_graph_pipeline/chunk_processing_pipeline/apply_tree_actions.py

```
"""
Tree Action Application Module
Handles applying integration decisions to the decision tree
"""

import logging
from typing import List, Set, Union

from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision, UpdateAction, CreateAction


class TreeActionApplier:
    """
    Applies tree actions (CREATE, APPEND, UPDATE) to the decision tree.
    
    This class encapsulates the logic for modifying the tree structure
    based on integration decisions from agentic workflows and optimization actions.
    """
    
    def __init__(self, decision_tree: DecisionTree):
        """
        Initialize the TreeActionApplier
        
        Args:
            decision_tree: The decision tree instance to apply actions to
        """
        self.decision_tree = decision_tree
        self.nodes_to_update: Set[int] = set()
    
    def apply_integration_decisions(self, integration_decisions: List[IntegrationDecision]) -> Set[int]:
        """
        Apply integration decisions from workflow result to the decision tree
        
        Args:
            integration_decisions: List of IntegrationDecision objects to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(integration_decisions)} integration decisions")
        
        for decision in integration_decisions:
            if decision.action == "CREATE":
                self._apply_create_action(decision)
            elif decision.action == "APPEND":
                self._apply_append_action(decision)
            else:
                logging.warning(f"Unknown action type: {decision.action}")
        
        return self.nodes_to_update.copy()
    
    def _apply_create_action(self, decision: IntegrationDecision):
        """
        Apply a CREATE action to create a new node in the tree
        
        Args:
            decision: The IntegrationDecision with CREATE action
        """
        # Find parent node ID from name or none if not specified
        parent_id = None  
        if decision.target_node:
            parent_id = self.decision_tree.get_node_id_from_name(decision.target_node)
        
        # Create new node
        new_node_id = self.decision_tree.create_new_node(
            name=decision.new_node_name,
            parent_node_id=parent_id,
            content=decision.content,
            summary=decision.new_node_summary,
            relationship_to_parent=decision.relationship_for_edge
        )
        logging.info(f"Created new node '{decision.new_node_name}' with ID {new_node_id}")
        
        # Add the new node to the update set
        self.nodes_to_update.add(new_node_id)
        
        # Also add the parent node to update set so its child links are updated
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")
    
    def _apply_append_action(self, decision: IntegrationDecision):
        """
        Apply an APPEND action to append content to an existing node
        
        Args:
            decision: The IntegrationDecision with APPEND action
        """
        # Find target node and append content
        if not decision.target_node:
            logging.warning(f"APPEND decision for '{decision.name}' has no target_node - skipping")
            return
            
        node_id = self.decision_tree.get_node_id_from_name(decision.target_node)
        if node_id is not None:
            node = self.decision_tree.tree[node_id]
            node.append_content(
                decision.content,
                None,  # APPEND decisions don't have new_node_summary in IntegrationDecision
                decision.name  # Use the chunk name as the label
            )
            logging.info(f"Appended content to node '{decision.target_node}' (ID {node_id})")
            # Add the updated node to the update set
            self.nodes_to_update.add(node_id)
        else:
            logging.warning(f"Could not find node '{decision.target_node}' for APPEND action")
    
    def get_nodes_to_update(self) -> Set[int]:
        """
        Get the set of node IDs that need to be updated
        
        Returns:
            Set of node IDs
        """
        return self.nodes_to_update.copy()
    
    def clear_nodes_to_update(self):
        """Clear the set of nodes to update"""
        self.nodes_to_update.clear()
    
    def apply_optimization_actions(self, actions: List[UpdateAction]) -> Set[int]:
        """
        Apply optimization actions (UPDATE) from the optimizer
        
        Args:
            actions: List of UpdateAction objects to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} optimization actions")
        
        for action in actions:
            if isinstance(action, UpdateAction):
                self._apply_update_action(action)
            else:
                logging.warning(f"Unexpected action type in optimization actions: {type(action)}")
        
        return self.nodes_to_update.copy()
    
    def apply_mixed_actions(self, actions: List[Union[UpdateAction, CreateAction, IntegrationDecision]]) -> Set[int]:
        """
        Apply a mixed list of actions (UPDATE, CREATE) to handle complex operations like SPLIT
        
        Args:
            actions: List of mixed action types to apply
            
        Returns:
            Set of node IDs that were updated
        """
        self.nodes_to_update.clear()
        logging.info(f"Applying {len(actions)} mixed actions")
        
        for action in actions:
            if isinstance(action, UpdateAction):
                self._apply_update_action(action)
            elif isinstance(action, CreateAction):
                self._apply_create_action_from_optimizer(action)
            elif isinstance(action, IntegrationDecision):
                # Handle IntegrationDecision for backward compatibility
                if action.action == "CREATE":
                    self._apply_create_action(action)
                elif action.action == "APPEND":
                    self._apply_append_action(action)
            else:
                logging.warning(f"Unknown action type: {type(action)}")
        
        return self.nodes_to_update.copy()
    
    def _apply_update_action(self, action: UpdateAction):
        """
        Apply an UPDATE action to modify node content and summary
        
        Args:
            action: The UpdateAction to apply
        """
        # Update the node using the decision tree's update_node method
        try:
            self.decision_tree.update_node(
                node_id=action.node_id,
                content=action.new_content,
                summary=action.new_summary
            )
            logging.info(f"Updated node with ID {action.node_id}")
            
            # Add the updated node to the update set
            self.nodes_to_update.add(action.node_id)
        except KeyError:
            logging.error(f"Could not find node with ID {action.node_id} for UPDATE action")
    
    def _apply_create_action_from_optimizer(self, action: CreateAction):
        """
        Apply a CREATE action from the optimizer (uses CreateAction model)
        
        Args:
            action: The CreateAction to apply
        """
        # Find parent node ID from name
        parent_id = None
        if action.target_node_name:
            parent_id = self.decision_tree.get_node_id_from_name(action.target_node_name)
            if parent_id is None:
                logging.warning(f"Could not find parent node '{action.target_node_name}' for CREATE action")
        
        # Create new node
        new_node_id = self.decision_tree.create_new_node(
            name=action.new_node_name,
            parent_node_id=parent_id,
            content=action.content,
            summary=action.summary,
            relationship_to_parent=action.relationship
        )
        logging.info(f"Created new node '{action.new_node_name}' with ID {new_node_id}")
        
        # Add the new node to the update set
        self.nodes_to_update.add(new_node_id)
        
        # Also add the parent node to update set if it exists
        if parent_id is not None:
            self.nodes_to_update.add(parent_id)
            logging.info(f"Added parent node (ID {parent_id}) to update set to refresh child links")```

-----------

## Filename: backend/text_to_graph_pipeline/tree_manager/decision_tree_ds.py

```
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional
import difflib
from .tree_to_markdown import generate_filename_from_keywords
from .utils import extract_summary

def extract_title_from_md(node_content):
    title_match = re.search(r'#+(.*)', node_content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else "Untitled"
    title = title.lower()
    return title

class Node:
    def __init__(self, name : str, node_id: int, content: str, summary: str = "", parent_id: int = None):
        self.transcript_history = ""
        self.id: int = node_id
        self.content: str = content
        self.parent_id: int | None = parent_id
        self.children: List[int] = []
        self.relationships: Dict[int, str] = {}
        self.created_at: datetime = datetime.now()
        self.modified_at: datetime = datetime.now()
        self.title = name
        self.filename: str = str(node_id) + "_" + generate_filename_from_keywords(self.title)
        self.summary: str = summary
        self.num_appends: int = 0

    def append_content(self, new_content: str, summary:str, transcript: str = ""):
        self.content += "\n" + new_content
        self.summary = summary if summary else extract_summary(new_content)
        self.transcript_history += transcript + "... "
        self.modified_at = datetime.now()
        self.num_appends += 1


class DecisionTree:
    def __init__(self):
        self.tree: Dict[int, Node] = {}
        self.next_node_id: int = 0

    def create_new_node(self, name: str, parent_node_id: int | None, content: str, summary : str, relationship_to_parent: str = "child of") -> int:
        if parent_node_id is not None and parent_node_id not in self.tree:
            logging.error(f"Warning: Trying to create a node with non-existent parent ID: {parent_node_id}")
            parent_node_id = None

        # Check if a similar node already exists as a child of this parent
        # todo, temp remove since unnec complexity for now.
        # existing_child_id = self._find_similar_child(name, parent_node_id)
        # if existing_child_id is not None:
        #     logging.info(f"Found existing similar child node '{self.tree[existing_child_id].title}' (ID: {existing_child_id}) under parent {parent_node_id}. Returning existing node instead of creating duplicate.")
        #     return existing_child_id

        # Only get and increment node_id after validation passes
        new_node_id = self.next_node_id
        new_node = Node(name, new_node_id, content, summary, parent_id=parent_node_id)
        if parent_node_id is not None:
            new_node.relationships[parent_node_id] = relationship_to_parent
        
        # Only increment after we successfully create the node
        self.tree[new_node_id] = new_node
        if parent_node_id is not None:
            self.tree[parent_node_id].children.append(new_node_id)

        self.tree[new_node_id].summary = summary if summary else extract_summary(content)
        
        # Increment AFTER successful creation
        self.next_node_id += 1

        return new_node_id

    def _find_similar_child(self, name: str, parent_node_id: int | None, similarity_threshold: float = 0.8) -> Optional[int]:
        """
        Check if a similar node already exists as a child of the given parent.
        
        Args:
            name: The name to check for similarity
            parent_node_id: The parent node ID to check children of
            similarity_threshold: Minimum similarity score (0.0 to 1.0)
            
        Returns:
            Node ID of similar child if found, None otherwise
        """
        if parent_node_id is None or parent_node_id not in self.tree:
            return None
            
        parent_node = self.tree[parent_node_id]
        if not parent_node.children:
            return None
            
        # Get names of all children
        child_names = []
        child_ids = []
        for child_id in parent_node.children:
            if child_id in self.tree:
                child_names.append(self.tree[child_id].title.lower())
                child_ids.append(child_id)
        
        # Find closest match among children
        closest_matches = difflib.get_close_matches(
            name.lower(), 
            child_names, 
            n=1, 
            cutoff=similarity_threshold
        )
        
        if closest_matches:
            # Find the ID of the matching child
            matched_name = closest_matches[0]
            for i, child_name in enumerate(child_names):
                if child_name == matched_name:
                    return child_ids[i]
                    
        return None

    def get_recent_nodes(self, num_nodes=10):
        """Returns a list of IDs of the most recently modified nodes."""
        sorted_nodes = sorted(self.tree.keys(), key=lambda k: self.tree[k].modified_at, reverse=True)
        return sorted_nodes[:num_nodes]

    def get_parent_id(self, node_id):
        """Returns the parent ID of the given node, or None if it's the root."""
        # assumes tree invariant
        for parent_id, node in self.tree.items():
            if node_id in node.children:
                return parent_id
        return None

    def get_node_id_from_name(self, name: str) -> int | None:
        """
        Search the tree for the node with the name most similar to the input name.
        Uses fuzzy matching to find the closest match.

        Args:
            name (str): The name of the node to find.

        Returns:
            int | None: The ID of the closest matching node, or None if no close match is found.
        """
        # Handle None or empty name
        if not name:
            return None
            
        # Generate a list of node titles
        node_titles = [node.title for node in self.tree.values()]
        node_titles_lower = [title.lower() for title in node_titles]

        # Find the closest match to the input name
        closest_matches = difflib.get_close_matches(name.lower(), node_titles_lower, n=1, cutoff=0.6)

        if closest_matches:
            # If a match is found, return the corresponding node ID
            # Find the original title that matched
            matched_lower = closest_matches[0]
            for i, title_lower in enumerate(node_titles_lower):
                if title_lower == matched_lower:
                    original_title = node_titles[i]
                    break
            
            for node_id, node in self.tree.items():
                if node.title == original_title:
                    return node_id

        #todo: this won't scale

        # If no match is found, try to use the most recently modified node
        # This is more likely to be semantically related
        recent_nodes = self.get_recent_nodes(num_nodes=5)
        
        if recent_nodes:
            parent_id = recent_nodes[0]
            logging.warning(f"No close match found for node name '{name}'. Using most recent node: {self.tree[parent_id].title}")
            return parent_id
        
        # Return None if there are no nodes at all
        logging.warning(f"No close match found for node name '{name}' and no nodes exist in the tree.")
        return None

    def get_neighbors(self, node_id: int) -> List[Dict]:
        """
        Returns immediate neighbors (parent, siblings, children) with summaries.
        
        Args:
            node_id: The ID of the node to get neighbors for
            
        Returns:
            List of dictionaries with structure:
            {"id": int, "name": str, "summary": str, "relationship": str}
            Where relationship is "parent", "sibling", or "child"
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        neighbors = []
        node = self.tree[node_id]
        
        # Get parent
        if node.parent_id is not None and node.parent_id in self.tree:
            parent_node = self.tree[node.parent_id]
            neighbors.append({
                "id": node.parent_id,
                "name": parent_node.title,
                "summary": parent_node.summary,
                "relationship": "parent"
            })
            
            # Get siblings (other children of the same parent)
            for sibling_id in parent_node.children:
                if sibling_id != node_id and sibling_id in self.tree:
                    sibling_node = self.tree[sibling_id]
                    neighbors.append({
                        "id": sibling_id,
                        "name": sibling_node.title,
                        "summary": sibling_node.summary,
                        "relationship": "sibling"
                    })
        
        # Get children
        for child_id in node.children:
            if child_id in self.tree:
                child_node = self.tree[child_id]
                neighbors.append({
                    "id": child_id,
                    "name": child_node.title,
                    "summary": child_node.summary,
                    "relationship": "child"
                })
        
        return neighbors

    def update_node(self, node_id: int, content: str, summary: str) -> None:
        """
        Replaces a node's content and summary completely.
        
        Args:
            node_id: The ID of the node to update
            content: The new content to replace existing content
            summary: The new summary to replace existing summary
            
        Raises:
            KeyError: If the node_id doesn't exist in the tree
        """
        if node_id not in self.tree:
            raise KeyError(f"Node {node_id} not found in tree")
            
        node = self.tree[node_id]
        node.content = content
        node.summary = summary
        node.modified_at = datetime.now()```

-----------

