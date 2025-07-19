import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch, Mock

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, CreateAction, UpdateAction
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow, WorkflowResult)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import (
    DecisionTree, Node)


class TestTreeActionDeciderWorkflow(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures"""
        self.decision_tree = DecisionTree()
        # Override the default tree with test nodes that have proper names and summaries
        self.decision_tree.tree = {
            0: Node(name="Parent Node", node_id=0, content="parent content", summary="Parent summary", parent_id=None),
            1: Node(name="Test Node", node_id=1, content="test content", summary="Test summary", parent_id=0),
        }
        # Fix the node names to match what we expect
        self.decision_tree.tree[0].title = "Parent Node"
        self.decision_tree.tree[1].title = "Test Node"
        
        self.workflow = TreeActionDeciderWorkflow(self.decision_tree)
    
    def test_workflow_initialization(self):
        """Test that TreeActionDeciderWorkflow initializes correctly"""
        # Assert
        self.assertEqual(self.workflow.decision_tree, self.decision_tree)
        self.assertIsNotNone(self.workflow.append_agent)
        self.assertIsNotNone(self.workflow.optimizer_agent)
    
    def test_process_full_buffer_with_actions(self):
        """Test process_full_buffer with successful actions"""
        async def async_test():
            # Mock the agents
            placement_actions = [
                AppendAction(action="APPEND", target_node_id=1, content="New content")
            ]
            optimization_actions = [
                CreateAction(
                    action="CREATE", 
                    parent_node_id=1, 
                    new_node_name="New Concept",
                    content="New content",
                    summary="New summary",
                    relationship="child of"
                ),
                UpdateAction(
                    action="UPDATE",
                    node_id=1,
                    new_content="Updated content",
                    new_summary="Updated summary"
                )
            ]
            
            self.workflow.append_agent.run = AsyncMock(return_value=placement_actions)
            self.workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)
            
            # Patch TreeActionApplier
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier_class:
                mock_applier = Mock()
                mock_applier.apply.return_value = {1}  # node 1 was modified
                mock_applier_class.return_value = mock_applier
                
                # Act
                result = await self.workflow.process_full_buffer("Test transcript")
                
                # Assert
                self.assertTrue(result.success)
                self.assertEqual(len(result.tree_actions), 2)
                self.assertEqual(result.new_nodes, ["New Concept"])
                self.assertEqual(result.metadata["actions_generated"], 2)
                self.assertEqual(result.metadata["processed_text"], "Test transcript")
        
        asyncio.run(async_test())
    
    def test_process_full_buffer_no_placement_actions(self):
        """Test process_full_buffer when no placement actions are generated"""
        async def async_test():
            # Mock append agent to return empty list
            self.workflow.append_agent.run = AsyncMock(return_value=[])
            
            # Act
            result = await self.workflow.process_full_buffer("Test transcript")
            
            # Assert
            self.assertTrue(result.success)
            self.assertEqual(len(result.tree_actions), 0)
            self.assertEqual(result.new_nodes, [])
            self.assertEqual(result.metadata["actions_generated"], 0)
        
        asyncio.run(async_test())
    
    def test_process_full_buffer_only_update_actions(self):
        """Test process_full_buffer with only UPDATE actions (no new nodes)"""
        async def async_test():
            placement_actions = [
                AppendAction(action="APPEND", target_node_id=1, content="New content")
            ]
            optimization_actions = [
                UpdateAction(
                    action="UPDATE",
                    node_id=1,
                    new_content="Updated content",
                    new_summary="Updated summary"
                )
            ]
            
            self.workflow.append_agent.run = AsyncMock(return_value=placement_actions)
            self.workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)
            
            # Patch TreeActionApplier
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier_class:
                mock_applier = Mock()
                mock_applier.apply.return_value = {1}
                mock_applier_class.return_value = mock_applier
                
                # Act
                result = await self.workflow.process_full_buffer("This is a test")
                
                # Assert
                self.assertTrue(result.success)
                self.assertEqual(len(result.tree_actions), 1)
                self.assertEqual(result.new_nodes, [])  # No CREATE actions
                self.assertIsInstance(result.tree_actions[0], UpdateAction)
        
        asyncio.run(async_test())
    
    def test_process_full_buffer_handles_errors(self):
        """Test that errors are handled gracefully"""
        async def async_test():
            # Mock agent to raise exception
            self.workflow.append_agent.run = AsyncMock(side_effect=Exception("Pipeline crashed"))
            
            # Act
            result = await self.workflow.process_full_buffer("This is a test")
            
            # Assert
            self.assertFalse(result.success)
            self.assertEqual(result.tree_actions, [])
            self.assertEqual(result.new_nodes, [])
            self.assertIn("Pipeline crashed", result.error_message)
        
        asyncio.run(async_test())
    
    def test_run_method_returns_optimization_actions(self):
        """Test that run() method returns only optimization actions"""
        async def async_test():
            placement_actions = [
                AppendAction(action="APPEND", target_node_id=1, content="New content")
            ]
            optimization_actions = [
                UpdateAction(
                    action="UPDATE",
                    node_id=1,
                    new_content="Updated content",
                    new_summary="Updated summary"
                )
            ]
            
            self.workflow.append_agent.run = AsyncMock(return_value=placement_actions)
            self.workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)
            
            # Patch TreeActionApplier
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionApplier') as mock_applier_class:
                mock_applier = Mock()
                mock_applier.apply.return_value = {1}
                mock_applier_class.return_value = mock_applier
                
                # Act
                actions = await self.workflow.run("This is new text", self.decision_tree, "context")
                
                # Assert
                self.assertEqual(actions, optimization_actions)
                # Verify placement actions were not returned
                self.assertNotIn(placement_actions[0], actions)
        
        asyncio.run(async_test())
    
    def test_get_workflow_statistics(self):
        """Test getting workflow statistics"""
        # Act
        stats = self.workflow.get_workflow_statistics()
        
        # Assert
        self.assertIn("total_nodes", stats)
        self.assertEqual(stats["total_nodes"], 2)  # We have 2 nodes in our test tree
        self.assertIn("message", stats)
    
    def test_clear_workflow_state(self):
        """Test clearing workflow state (should be a no-op for stateless workflow)"""
        # Act
        self.workflow.clear_workflow_state()
        
        # Assert - nothing to assert as it's a no-op, just ensure no errors
        self.assertTrue(True)
    
    def test_workflow_without_decision_tree(self):
        """Test workflow behavior when no decision tree is set"""
        async def async_test():
            # Create workflow without decision tree
            workflow = TreeActionDeciderWorkflow()
            
            # Act
            result = await workflow.process_full_buffer("Test", "context")
            
            # Assert
            self.assertFalse(result.success)
            self.assertIn("No decision tree", result.error_message)
        
        asyncio.run(async_test())


if __name__ == '__main__':
    unittest.main()