# Phase 2 TDD Implementation Plan

## Overview
This document outlines the TDD implementation plan for the three agents in Phase 2 of the VoiceTree pipeline redesign.

## Agent 1: AppendToRelevantNodeAgent

### Purpose
Takes raw text and produces placement actions (AppendAction or CreateAction) using a two-prompt flow:
1. Segmentation: Break text into atomic ideas
2. Target identification: Map each segment to existing nodes or propose new ones

### TDD Implementation Steps

#### Step 1.1: Write Failing Tests
```python
# backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/AppendToRelevantNodeAgent/testAppendtoRelevantNodeAgent.py

import pytest
from backend.text_to_graph_pipeline.agentic_workflows.agents.append_to_relevant_node_agent import AppendToRelevantNodeAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction, CreateAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node

class TestAppendToRelevantNodeAgent:
    
    @pytest.fixture
    def agent(self):
        return AppendToRelevantNodeAgent()
    
    @pytest.fixture
    def simple_tree(self):
        tree = DecisionTree()
        node = Node(id=1, name="Database Design", summary="Database architecture decisions")
        tree.nodes[1] = node
        tree.root_ids = {1}
        return tree
    
    async def test_simple_append(self, agent, simple_tree):
        """Test Case 1: Text clearly relates to existing node"""
        text = "We need to add an index to the users table for performance."
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree
        )
        
        assert len(actions) == 1
        assert isinstance(actions[0], AppendAction)
        assert actions[0].target_node_id == 1
        assert actions[0].content == text
    
    async def test_simple_create(self, agent, simple_tree):
        """Test Case 2: Text is unrelated to any existing node"""
        text = "Let's set up the new CI/CD pipeline using GitHub Actions."
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=simple_tree
        )
        
        assert len(actions) == 1
        assert isinstance(actions[0], CreateAction)
        assert actions[0].new_node_name == "CI/CD Pipeline"
        assert actions[0].content == text
        assert actions[0].parent_node_id is None  # Root level
    
    async def test_mixed_append_and_create(self, agent):
        """Test Case 3: Multiple segments, some append, some create"""
        tree = DecisionTree()
        node = Node(id=1, name="User Authentication", summary="Auth system design")
        tree.nodes[1] = node
        tree.root_ids = {1}
        
        text = "We should enforce stronger password policies. Also, we need to set up rate limiting on the API."
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=tree
        )
        
        assert len(actions) == 2
        # First segment appends to existing auth node
        assert isinstance(actions[0], AppendAction)
        assert actions[0].target_node_id == 1
        # Second segment creates new node
        assert isinstance(actions[1], CreateAction)
        assert "rate limiting" in actions[1].new_node_name.lower()
    
    async def test_empty_tree(self, agent):
        """Test Case 4: Empty tree, all creates"""
        tree = DecisionTree()
        
        text = "First, let's define the project requirements. Second, we need to choose a tech stack."
        
        actions = await agent.run(
            transcript_text=text,
            decision_tree=tree
        )
        
        assert len(actions) == 2
        assert all(isinstance(action, CreateAction) for action in actions)
        assert actions[0].parent_node_id is None
        assert actions[1].parent_node_id is None
```

#### Step 1.2: Implement the Agent
```python
# backend/text_to_graph_pipeline/agentic_workflows/agents/append_to_relevant_node_agent.py

from typing import List, Union
from ..core.agent import Agent
from ..core.state import BaseState
from ..models import (
    SegmentationResponse, 
    TargetNodeResponse,
    AppendAction, 
    CreateAction
)
from ...tree_manager.decision_tree_ds import DecisionTree

class AppendToRelevantNodeAgent(Agent):
    """Agent that determines where to place new content in the tree"""
    
    def __init__(self):
        super().__init__("AppendToRelevantNodeAgent", BaseState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Configure the two-prompt workflow"""
        self.add_prompt(
            "segmentation",
            "segmentation",  # References prompts/segmentation.md
            SegmentationResponse
        )
        
        self.add_prompt(
            "identify_target",
            "identify_target_node",  # References prompts/identify_target_node.md
            TargetNodeResponse
        )
        
        self.add_dataflow("segmentation", "identify_target")
        self.add_dataflow("identify_target", END)
    
    async def run(
        self, 
        transcript_text: str, 
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> List[Union[AppendAction, CreateAction]]:
        """
        Process text and return placement actions
        
        Returns:
            List of AppendAction or CreateAction objects
        """
        # Create initial state
        initial_state = {
            "transcript_text": transcript_text,
            "transcript_history": transcript_history,
            "existing_nodes": self._format_nodes_for_prompt(decision_tree),
            "segments": None,
            "target_nodes": None
        }
        
        # Run the workflow
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Convert TargetNodeIdentification to actions (translation layer)
        actions = []
        for target in result["target_nodes"]:
            if target.target_node_id != -1:
                # Existing node - create AppendAction
                actions.append(AppendAction(
                    action="APPEND",
                    target_node_id=target.target_node_id,
                    content=target.text
                ))
            else:
                # New node - create CreateAction
                actions.append(CreateAction(
                    action="CREATE",
                    parent_node_id=None,  # Could be enhanced with parent logic
                    new_node_name=target.new_node_name,
                    content=target.text,
                    summary=f"Summary for {target.new_node_name}",
                    relationship="subtopic of"
                ))
        
        return actions
    
    def _format_nodes_for_prompt(self, tree: DecisionTree) -> str:
        """Format tree nodes for LLM prompt"""
        if not tree.nodes:
            return "No existing nodes"
        
        node_descriptions = []
        for node_id, node in tree.nodes.items():
            node_descriptions.append(
                f'{{"id": {node_id}, "name": "{node.name}", "summary": "{node.summary}"}}'
            )
        
        return f"[{', '.join(node_descriptions)}]"
```

## Agent 2: SingleAbstractionOptimizerAgent

### Purpose
Takes a node ID and analyzes if it should be refactored (split, reorganized) based on the mathematical optimization framework.

### TDD Implementation Steps

#### Step 2.1: Write Failing Tests
```python
# backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/SingleAbstractionOptimizerAgent/testSingleAbstractionOptimizerAgent.py

import pytest
from backend.text_to_graph_pipeline.agentic_workflows.agents.single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import UpdateAction, CreateAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node

class TestSingleAbstractionOptimizerAgent:
    
    @pytest.fixture
    def agent(self):
        return SingleAbstractionOptimizerAgent()
    
    async def test_no_optimization_needed(self, agent):
        """Well-structured node needs no changes"""
        tree = DecisionTree()
        node = Node(
            id=1, 
            name="Database Schema", 
            summary="Define user and product tables",
            content="We need user table with id, email, name. Product table with id, name, price."
        )
        tree.nodes[1] = node
        
        actions = await agent.run(node_id=1, decision_tree=tree)
        
        assert len(actions) == 0  # No optimization needed
    
    async def test_split_overloaded_node(self, agent):
        """Node contains multiple distinct concepts that should be split"""
        tree = DecisionTree()
        node = Node(
            id=1,
            name="System Setup",
            summary="Everything about setup",
            content="""First we need to configure the database with proper indexes.
            Then we should set up the authentication system with JWT tokens.
            Finally, configure the CI/CD pipeline with automated tests."""
        )
        tree.nodes[1] = node
        
        actions = await agent.run(node_id=1, decision_tree=tree)
        
        # Should split into 3 nodes
        assert len(actions) >= 3
        create_actions = [a for a in actions if isinstance(a, CreateAction)]
        assert len(create_actions) >= 2  # At least 2 new nodes
        
        # Check that new nodes have appropriate names
        node_names = [a.new_node_name for a in create_actions]
        assert any("database" in name.lower() for name in node_names)
        assert any("auth" in name.lower() or "jwt" in name.lower() for name in node_names)
    
    async def test_update_poorly_summarized_node(self, agent):
        """Node with vague summary should be updated"""
        tree = DecisionTree()
        node = Node(
            id=1,
            name="API Design",
            summary="Some API stuff",  # Poor summary
            content="Design RESTful endpoints for user CRUD operations with proper HTTP verbs and status codes"
        )
        tree.nodes[1] = node
        
        actions = await agent.run(node_id=1, decision_tree=tree)
        
        # Should update the node with better summary
        update_actions = [a for a in actions if isinstance(a, UpdateAction)]
        assert len(update_actions) == 1
        assert update_actions[0].node_id == 1
        assert "REST" in update_actions[0].new_summary or "endpoint" in update_actions[0].new_summary
```

#### Step 2.2: Implement the Agent
```python
# backend/text_to_graph_pipeline/agentic_workflows/agents/single_abstraction_optimizer_agent.py

from typing import List, Union
from ..core.agent import Agent
from ..core.state import BaseState
from ..models import OptimizationResponse, UpdateAction, CreateAction
from ...tree_manager.decision_tree_ds import DecisionTree

class SingleAbstractionOptimizerAgent(Agent):
    """Agent that optimizes individual nodes for cognitive clarity"""
    
    def __init__(self):
        super().__init__("SingleAbstractionOptimizerAgent", BaseState)
        self._setup_workflow()
    
    def _setup_workflow(self):
        """Single prompt workflow"""
        self.add_prompt(
            "optimize",
            "single_abstraction_optimizer",  # References prompts/single_abstraction_optimizer.md
            OptimizationResponse
        )
        
        self.add_dataflow("optimize", END)
    
    async def run(
        self,
        node_id: int,
        decision_tree: DecisionTree
    ) -> List[Union[UpdateAction, CreateAction]]:
        """
        Analyze and optimize a single node
        
        Returns:
            List of optimization actions (can be empty if no optimization needed)
        """
        node = decision_tree.nodes.get(node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")
        
        # Get neighbor context
        neighbors = self._get_neighbor_context(node_id, decision_tree)
        
        # Create state
        initial_state = {
            "node_id": node_id,
            "node_name": node.name,
            "node_content": node.content,
            "node_summary": node.summary,
            "neighbors": neighbors
        }
        
        # Run optimization
        app = self.compile()
        result = await app.ainvoke(initial_state)
        
        # Extract actions from response
        return result["optimization_decision"]["actions"]
    
    def _get_neighbor_context(self, node_id: int, tree: DecisionTree) -> str:
        """Format neighbor nodes for context"""
        neighbors = tree.get_neighbors(node_id)
        
        neighbor_list = []
        for rel_type, nodes in neighbors.items():
            for node in nodes:
                neighbor_list.append({
                    "id": node.id,
                    "name": node.name,
                    "summary": node.summary,
                    "relationship": rel_type
                })
        
        return str(neighbor_list)
```

## Agent 3: TreeActionDeciderAgent (Orchestrator)

### Purpose
Coordinates the full two-step pipeline:
1. Run AppendToRelevantNodeAgent to get placement actions
2. Apply placement actions to tree
3. Run SingleAbstractionOptimizerAgent on modified nodes
4. Return final optimization actions

### TDD Implementation Steps

#### Step 3.1: Write Failing Tests
```python
# backend/tests/integration_tests/agentic_workflows/agents_and_prompts_tests/tree_action_decider/test_tree_action_decider.py

import pytest
from unittest.mock import Mock, AsyncMock
from backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent import TreeActionDeciderAgent
from backend.text_to_graph_pipeline.agentic_workflows.models import AppendAction, CreateAction, UpdateAction
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node

class TestTreeActionDeciderAgent:
    
    @pytest.fixture
    def agent(self):
        return TreeActionDeciderAgent()
    
    @pytest.fixture
    def mock_append_agent(self, monkeypatch):
        mock = Mock()
        mock.run = AsyncMock()
        monkeypatch.setattr(
            "backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent.AppendToRelevantNodeAgent",
            lambda: mock
        )
        return mock
    
    @pytest.fixture
    def mock_optimizer_agent(self, monkeypatch):
        mock = Mock()
        mock.run = AsyncMock()
        monkeypatch.setattr(
            "backend.text_to_graph_pipeline.agentic_workflows.agents.tree_action_decider_agent.SingleAbstractionOptimizerAgent",
            lambda: mock
        )
        return mock
    
    async def test_full_pipeline_flow(self, agent, mock_append_agent, mock_optimizer_agent):
        """Test complete two-step pipeline"""
        # Setup tree
        tree = DecisionTree()
        node = Node(id=1, name="Project Setup", summary="Initial setup")
        tree.nodes[1] = node
        
        # Mock append agent to return placement actions
        mock_append_agent.run.return_value = [
            AppendAction(action="APPEND", target_node_id=1, content="Configure database"),
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="API Design",
                content="Design REST endpoints",
                summary="API architecture",
                relationship="related to"
            )
        ]
        
        # Mock optimizer to return optimization for node 1
        mock_optimizer_agent.run.return_value = [
            UpdateAction(
                action="UPDATE",
                node_id=1,
                new_content="Configure PostgreSQL with proper indexes",
                new_summary="Database configuration and optimization"
            )
        ]
        
        # Run the orchestrator
        result = await agent.run(
            transcript_text="Configure database. Design REST endpoints.",
            decision_tree=tree
        )
        
        # Verify append agent was called
        mock_append_agent.run.assert_called_once()
        
        # Verify optimizer was called for modified nodes
        # Should be called twice: once for node 1 (appended), once for new node 2
        assert mock_optimizer_agent.run.call_count == 2
        
        # Verify final actions
        assert len(result) >= 1
        assert any(isinstance(action, UpdateAction) for action in result)
    
    async def test_no_optimization_needed(self, agent, mock_append_agent, mock_optimizer_agent):
        """Test when nodes don't need optimization"""
        tree = DecisionTree()
        
        # Mock append agent to create new node
        mock_append_agent.run.return_value = [
            CreateAction(
                action="CREATE",
                parent_node_id=None,
                new_node_name="Simple Task",
                content="Do something simple",
                summary="A simple task",
                relationship="subtask of"
            )
        ]
        
        # Mock optimizer to return no actions (no optimization needed)
        mock_optimizer_agent.run.return_value = []
        
        result = await agent.run(
            transcript_text="Do something simple",
            decision_tree=tree
        )
        
        # Should return empty list when no optimization needed
        assert result == []
```

#### Step 3.2: Implement the Orchestrator
```python
# backend/text_to_graph_pipeline/agentic_workflows/agents/tree_action_decider_agent.py

from typing import List, Union
from ...chunk_processing_pipeline.apply_tree_actions import TreeActionApplier
from ...tree_manager.decision_tree_ds import DecisionTree
from ..models import BaseTreeAction, UpdateAction, CreateAction
from .append_to_relevant_node_agent import AppendToRelevantNodeAgent
from .single_abstraction_optimizer_agent import SingleAbstractionOptimizerAgent

class TreeActionDeciderAgent:
    """Orchestrates the two-step tree update pipeline"""
    
    def __init__(self):
        self.append_agent = AppendToRelevantNodeAgent()
        self.optimizer_agent = SingleAbstractionOptimizerAgent()
    
    async def run(
        self,
        transcript_text: str,
        decision_tree: DecisionTree,
        transcript_history: str = ""
    ) -> List[Union[UpdateAction, CreateAction]]:
        """
        Execute the complete two-step pipeline
        
        Steps:
        1. Get placement actions from AppendToRelevantNodeAgent
        2. Apply placement actions to tree
        3. Optimize each modified node
        4. Return optimization actions
        
        Returns:
            List of optimization actions to be applied
        """
        # Step 1: Get placement plan
        placement_actions = await self.append_agent.run(
            transcript_text=transcript_text,
            decision_tree=decision_tree,
            transcript_history=transcript_history
        )
        
        # Step 2: Apply placement actions
        applier = TreeActionApplier(decision_tree)
        modified_node_ids = applier.apply(placement_actions)
        
        # Step 3: Optimize each modified node
        final_actions = []
        for node_id in modified_node_ids:
            optimization_actions = await self.optimizer_agent.run(
                node_id=node_id,
                decision_tree=decision_tree
            )
            final_actions.extend(optimization_actions)
        
        # Step 4: Return optimization actions
        return final_actions
```

## Tasks Suitable for Sub-Agent Delegation

Based on the TDD approach, these tasks are well-isolated and suitable for sub-agent delegation:

1. **Test Implementation for Each Agent**
   - Each test file is self-contained
   - Clear specifications in test outlines
   - No deep understanding of entire system needed

2. **Prompt Testing**
   - Verify prompts produce expected output formats
   - Can be tested in isolation

3. **Mock Creation for Integration Tests**
   - Creating mock DecisionTree instances
   - Setting up test fixtures

4. **Error Handling Implementation**
   - Adding try-catch blocks
   - Validation logic for inputs

5. **Documentation Updates**
   - Updating docstrings
   - Creating usage examples

## Next Steps

1. Start with implementing failing tests for AppendToRelevantNodeAgent
2. Implement the agent to make tests pass
3. Repeat for SingleAbstractionOptimizerAgent
4. Implement the orchestrator TreeActionDeciderAgent
5. Run integration tests with ChunkProcessor

This TDD approach ensures:
- Clear specifications before implementation
- Testable, modular code
- Easy delegation of isolated tasks
- Confidence in the final system