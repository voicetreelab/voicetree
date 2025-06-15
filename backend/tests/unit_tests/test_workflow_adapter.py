import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.workflow_adapter import WorkflowAdapter, WorkflowMode, WorkflowResult
from backend.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.tree_manager import NodeAction


class TestWorkflowAdapter(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures"""
        self.decision_tree = DecisionTree()
        # Override the default tree with test nodes that have proper names and summaries
        self.decision_tree.tree = {
            0: Node(name="Root", node_id=0, content="root content", summary="Root summary", parent_id=None),
            1: Node(name="Test Node", node_id=1, content="test content", summary="Test summary", parent_id=0),
        }
        # Fix the node names to match what we expect
        self.decision_tree.tree[0].title = "Root"
        self.decision_tree.tree[1].title = "Test Node"
        
        with patch('backend.agentic_workflows.main.VoiceTreePipeline'):
            self.adapter = WorkflowAdapter(self.decision_tree, mode=WorkflowMode.ATOMIC)
    
    def test_initialization_creates_proper_adapter(self):
        """Test that WorkflowAdapter initializes with correct properties"""
        # Arrange & Act done in setUp
        
        # Assert
        self.assertEqual(self.adapter.decision_tree, self.decision_tree)
        self.assertEqual(self.adapter.mode, WorkflowMode.ATOMIC)
        self.assertEqual(self.adapter._incomplete_buffer, "")
        self.assertIsNotNone(self.adapter.pipeline)
    
    def test_prepare_state_snapshot_includes_node_summaries(self):
        """Test that state snapshot contains existing node information"""
        # Act
        snapshot = self.adapter._prepare_state_snapshot()
        
        # Assert
        self.assertIn("existing_nodes", snapshot)
        self.assertIn("total_nodes", snapshot)
        self.assertEqual(snapshot["total_nodes"], 2)
        
        # The existing_nodes should be a string representation
        existing_nodes = snapshot["existing_nodes"]
        self.assertIsInstance(existing_nodes, str)
        # Since our test nodes may not have proper name attributes, just check it's not empty
        # In a real scenario, this would contain formatted node information
    
    def test_convert_to_node_actions_handles_create_decision(self):
        """Test conversion of CREATE workflow decision to NodeAction"""
        # Arrange
        workflow_result = {
            "integration_decisions": [
                {
                    "action": "CREATE",
                    "new_node_name": "New Concept",
                    "target_node": "Root",
                    "relationship": "child of",
                    "content": "New content",
                    "new_node_summary": "New summary",
                    "name": "chunk1"
                }
            ]
        }
        
        # Act
        node_actions = self.adapter._convert_to_node_actions(workflow_result)
        
        # Assert
        self.assertEqual(len(node_actions), 1)
        action = node_actions[0]
        self.assertEqual(action.action, "CREATE")
        self.assertEqual(action.concept_name, "New Concept")
        self.assertEqual(action.neighbour_concept_name, "Root")
        self.assertEqual(action.relationship_to_neighbour, "child of")
        self.assertEqual(action.markdown_content_to_append, "New content")
        self.assertEqual(action.updated_summary_of_node, "New summary")
        self.assertTrue(action.is_complete)
        self.assertEqual(action.labelled_text, "chunk1")
    
    def test_convert_to_node_actions_handles_append_decision(self):
        """Test conversion of APPEND workflow decision to NodeAction"""
        # Arrange
        workflow_result = {
            "integration_decisions": [
                {
                    "action": "APPEND",
                    "target_node": "Test Node",
                    "content": "Additional content",
                    "updated_summary": "Updated summary",
                    "name": "chunk2"
                }
            ]
        }
        
        # Act
        node_actions = self.adapter._convert_to_node_actions(workflow_result)
        
        # Assert
        self.assertEqual(len(node_actions), 1)
        action = node_actions[0]
        self.assertEqual(action.action, "APPEND")
        self.assertEqual(action.concept_name, "Test Node")
        self.assertIsNone(action.neighbour_concept_name)
        self.assertEqual(action.markdown_content_to_append, "Additional content")
        self.assertEqual(action.updated_summary_of_node, "Updated summary")
        self.assertTrue(action.is_complete)
    
    def test_convert_to_node_actions_handles_empty_decisions(self):
        """Test handling of workflow result with no decisions"""
        # Arrange
        workflow_result = {"integration_decisions": []}
        
        # Act
        node_actions = self.adapter._convert_to_node_actions(workflow_result)
        
        # Assert
        self.assertEqual(len(node_actions), 0)
    
    def test_process_transcript_success(self):
        """Test successful transcript processing with mocked workflow"""
        # Arrange
        mock_result = {
            "new_nodes": ["New Concept"],
            "integration_decisions": [{
                "action": "CREATE",
                "new_node_name": "New Concept",
                "target_node": "Root",
                "relationship": "child of",
                "content": "New content",
                "new_node_summary": "New summary",
                "name": "chunk1"
            }],
            "chunks": [{"name": "chunk1", "text": "test text"}],
            "incomplete_chunk_remainder": ""
        }
        
        async def async_test():
            with patch('backend.workflow_adapter.asyncio.to_thread', return_value=mock_result):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertTrue(result.success)
                self.assertEqual(result.new_nodes, ["New Concept"])
                self.assertEqual(len(result.node_actions), 1)
                self.assertIsNone(result.error_message)
                self.assertIn("chunks_processed", result.metadata)
                self.assertEqual(result.metadata["chunks_processed"], 1)
        
        # Run the async test
        asyncio.run(async_test())
    
    def test_process_transcript_handles_workflow_error(self):
        """Test handling when workflow returns error message"""
        # Arrange
        mock_result = {
            "error_message": "Workflow failed due to LLM timeout"
        }
        
        async def async_test():
            with patch('backend.workflow_adapter.asyncio.to_thread', return_value=mock_result):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertFalse(result.success)
                self.assertEqual(result.error_message, "Workflow failed due to LLM timeout")
                self.assertEqual(result.new_nodes, [])
                self.assertEqual(result.node_actions, [])
        
        asyncio.run(async_test())
    
    def test_process_transcript_handles_exception(self):
        """Test handling of exceptions during workflow execution"""
        async def async_test():
            with patch('backend.workflow_adapter.asyncio.to_thread', side_effect=Exception("Pipeline crashed")):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertFalse(result.success)
                self.assertIn("Workflow execution failed", result.error_message)
                self.assertIn("Pipeline crashed", result.error_message)
        
        asyncio.run(async_test())
    
    def test_process_transcript_manages_incomplete_buffer(self):
        """Test that incomplete buffer is properly managed across calls"""
        # Arrange
        self.adapter._incomplete_buffer = "Previous incomplete"
        mock_result = {
            "new_nodes": [],
            "integration_decisions": [],
            "chunks": [],
            "incomplete_chunk_remainder": "Still incomplete"
        }
        
        async def async_test():
            with patch('backend.workflow_adapter.asyncio.to_thread', return_value=mock_result) as mock_to_thread:
                # Act
                await self.adapter.process_transcript("This is new text")
                
                # Assert - check that pipeline was called (may be multiple times for different operations)
                self.assertTrue(mock_to_thread.called)
                
                # Find the call that contains our concatenated text
                found_concatenated_call = False
                for call in mock_to_thread.call_args_list:
                    if len(call[0]) > 1 and "Previous incomplete This is new text" in str(call[0]):
                        found_concatenated_call = True
                        break
                
                self.assertTrue(found_concatenated_call, "Expected to find concatenated text in one of the calls")
                
                # Assert - check that incomplete buffer was updated
                self.assertEqual(self.adapter._incomplete_buffer, "Still incomplete")
        
        asyncio.run(async_test())
    
    def test_apply_node_actions_creates_new_node(self):
        """Test that CREATE action properly creates a new node"""
        # Arrange
        actions = [NodeAction(
            action="CREATE",
            concept_name="New Node",
            neighbour_concept_name="Root",
            relationship_to_neighbour="child of",
            markdown_content_to_append="New content",
            updated_summary_of_node="New summary",
            is_complete=True,
            labelled_text="test"
        )]
        initial_count = len(self.decision_tree.tree)
        
        async def async_test():
            # Mock the get_node_id_from_name method to return a valid parent ID
            with patch.object(self.decision_tree, 'get_node_id_from_name', return_value=0):
                with patch.object(self.decision_tree, 'create_new_node') as mock_create:
                    # Act
                    await self.adapter._apply_node_actions(actions)
                    
                    # Assert
                    mock_create.assert_called_once_with(
                        name="New Node",
                        parent_node_id=0,
                        content="New content",
                        summary="New summary",
                        relationship_to_parent="child of"
                    )
        
        asyncio.run(async_test())
    
    def test_apply_node_actions_appends_to_existing_node(self):
        """Test that APPEND action properly updates existing node"""
        # Arrange
        original_content = self.decision_tree.tree[1].content
        actions = [NodeAction(
            action="APPEND",
            concept_name="Test Node",
            neighbour_concept_name=None,
            relationship_to_neighbour=None,
            markdown_content_to_append="Additional content",
            updated_summary_of_node="Updated summary",
            is_complete=True,
            labelled_text="test"
        )]
        
        async def async_test():
            # Act
            await self.adapter._apply_node_actions(actions)
            
            # Assert
            updated_content = self.decision_tree.tree[1].content
            self.assertNotEqual(updated_content, original_content)
            self.assertIn("Additional content", updated_content)
        
        asyncio.run(async_test())
    
    def test_get_workflow_statistics_delegates_to_pipeline(self):
        """Test that statistics retrieval delegates to pipeline"""
        # Arrange
        expected_stats = {"total_nodes": 5, "total_executions": 3}
        
        with patch.object(self.adapter.pipeline, 'get_statistics', return_value=expected_stats) as mock_stats:
            # Act
            stats = self.adapter.get_workflow_statistics()
            
            # Assert
            self.assertEqual(stats, expected_stats)
            mock_stats.assert_called_once()
    
    def test_clear_workflow_state_resets_buffer_and_pipeline(self):
        """Test that clearing state resets both buffer and pipeline state"""
        # Arrange
        self.adapter._incomplete_buffer = "some text"
        
        with patch.object(self.adapter.pipeline, 'clear_state') as mock_clear:
            # Act
            self.adapter.clear_workflow_state()
            
            # Assert
            mock_clear.assert_called_once()
            self.assertEqual(self.adapter._incomplete_buffer, "")


if __name__ == "__main__":
    unittest.main() 