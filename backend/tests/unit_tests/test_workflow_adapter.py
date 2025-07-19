import asyncio
import unittest
from unittest.mock import AsyncMock, Mock

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, CreateAction, UpdateAction, AppendAgentResult, SegmentModel
)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import (
    TreeActionDeciderWorkflow
)
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import (
    DecisionTree, Node)
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager
from backend.text_to_graph_pipeline.chunk_processing_pipeline.apply_tree_actions import TreeActionApplier


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
    
    def test_process_text_chunk_with_actions(self):
        """Test process_text_chunk with successful actions"""
        async def async_test():
            # Mock the agents
            placement_actions = [
                AppendAction(action="APPEND", target_node_id=1, content="New content")
            ]
            placement_result = AppendAgentResult(
                actions=placement_actions,
                completed_text="Test transcript",
                segments=[SegmentModel(reasoning="test", text="Test transcript", is_complete=True)]
            )
            
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
            
            self.workflow.append_agent.run = AsyncMock(return_value=placement_result)
            self.workflow.optimizer_agent.run = AsyncMock(return_value=optimization_actions)
            
            # Create mock dependencies
            buffer_manager = Mock(spec=TextBufferManager)
            buffer_manager.flushCompletelyProcessedText = Mock()
            tree_applier = Mock(spec=TreeActionApplier)
            tree_applier.apply = Mock(return_value={1})  # node 1 was modified
            
            # Act
            result = await self.workflow.process_text_chunk(
                "Test transcript", 
                "history",
                tree_applier,
                buffer_manager
            )
            
            # Assert
            self.assertEqual(result, {1})  # Returns set of modified nodes
            # Verify buffer was flushed
            buffer_manager.flushCompletelyProcessedText.assert_called_once_with("Test transcript")
            # Verify actions were applied
            self.assertEqual(tree_applier.apply.call_count, 2)  # Once for placement, once for optimization
        
        asyncio.run(async_test())
    
    def test_process_text_chunk_no_placement_actions(self):
        """Test process_text_chunk when no placement actions are generated"""
        async def async_test():
            # Mock append agent to return empty actions
            placement_result = AppendAgentResult(
                actions=[],
                completed_text="",
                segments=[]
            )
            self.workflow.append_agent.run = AsyncMock(return_value=placement_result)
            self.workflow.optimizer_agent.run = AsyncMock()  # Mock optimizer too
            
            # Create mock dependencies
            buffer_manager = Mock(spec=TextBufferManager)
            tree_applier = Mock(spec=TreeActionApplier)
            
            # Act
            result = await self.workflow.process_text_chunk(
                "Test transcript",
                "history", 
                tree_applier,
                buffer_manager
            )
            
            # Assert
            self.assertEqual(result, set())  # No nodes modified
            # Optimizer should not be called if no placement actions
            self.workflow.optimizer_agent.run.assert_not_called()
        
        asyncio.run(async_test())
    
    def test_process_text_chunk_handles_errors(self):
        """Test that errors are handled gracefully"""
        async def async_test():
            # Mock agent to raise exception
            self.workflow.append_agent.run = AsyncMock(side_effect=Exception("Pipeline crashed"))
            
            # Create mock dependencies
            buffer_manager = Mock(spec=TextBufferManager)
            tree_applier = Mock(spec=TreeActionApplier)
            
            # Act
            result = await self.workflow.process_text_chunk(
                "This is a test",
                "history",
                tree_applier,
                buffer_manager
            )
            
            # Assert - should return empty set on error
            self.assertEqual(result, set())
            # No actions should have been applied
            tree_applier.apply.assert_not_called()
        
        asyncio.run(async_test())
    
    def test_orphan_node_merging(self):
        """Test that multiple orphan nodes are merged into one"""
        async def async_test():
            # Mock multiple orphan create actions
            placement_actions = [
                CreateAction(
                    action="CREATE",
                    parent_node_id=None,  # Orphan
                    new_node_name="Orphan 1",
                    content="Content 1",
                    summary="Summary 1",
                    relationship=""
                ),
                CreateAction(
                    action="CREATE", 
                    parent_node_id=None,  # Orphan
                    new_node_name="Orphan 2",
                    content="Content 2", 
                    summary="Summary 2",
                    relationship=""
                ),
                AppendAction(action="APPEND", target_node_id=1, content="Regular append")
            ]
            placement_result = AppendAgentResult(
                actions=placement_actions,
                completed_text="Test",
                segments=[SegmentModel(reasoning="test", text="Test", is_complete=True)]
            )
            
            self.workflow.append_agent.run = AsyncMock(return_value=placement_result)
            self.workflow.optimizer_agent.run = AsyncMock(return_value=[])
            
            # Create mock dependencies
            buffer_manager = Mock(spec=TextBufferManager)
            buffer_manager.flushCompletelyProcessedText = Mock()
            tree_applier = Mock(spec=TreeActionApplier)
            tree_applier.apply = Mock(return_value={1})
            
            # Act
            await self.workflow.process_text_chunk(
                "Test",
                "history", 
                tree_applier,
                buffer_manager
            )
            
            # Assert - should have merged orphans
            call_args = tree_applier.apply.call_args_list[0][0][0]  # First call, first arg
            # Should have 2 actions: 1 merged orphan + 1 append
            self.assertEqual(len(call_args), 2)
            # Check the merged orphan
            merged_orphan = next(a for a in call_args if isinstance(a, CreateAction) and a.parent_node_id is None)
            self.assertIn("Orphan 1", merged_orphan.new_node_name)
            self.assertIn("Orphan 2", merged_orphan.new_node_name)
            self.assertIn("Content 1", merged_orphan.content)
            self.assertIn("Content 2", merged_orphan.content)
        
        asyncio.run(async_test())


if __name__ == '__main__':
    unittest.main()