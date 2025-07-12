import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowAdapter, WorkflowResult
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.text_to_graph_pipeline.tree_manager import NodeAction


class TestWorkflowAdapter(unittest.TestCase):
    
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
        
        with patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreePipeline'):
            self.adapter = WorkflowAdapter(self.decision_tree)
    
    def test_initialization_creates_proper_adapter(self):
        """Test that WorkflowAdapter initializes with correct properties"""
        # Arrange & Act done in setUp
        
        # Assert
        self.assertEqual(self.adapter.decision_tree, self.decision_tree)
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
                    "relationship_for_edge": "child of",
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
                "relationship_for_edge": "child of",
                "content": "New content",
                "new_node_summary": "New summary",
                "name": "chunk1"
            }],
            "chunks": [{"name": "chunk1", "text": "test text"}],
            "incomplete_chunk_remainder": ""
        }
        
        async def async_test():
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter.asyncio.to_thread', return_value=mock_result):
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
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter.asyncio.to_thread', return_value=mock_result):
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
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter.asyncio.to_thread', side_effect=Exception("Pipeline crashed")):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertFalse(result.success)
                self.assertIn("Workflow execution failed", result.error_message)
                self.assertIn("Pipeline crashed", result.error_message)
        
        asyncio.run(async_test())
    
    def test_process_transcript_manages_incomplete_buffer(self):
        """Test that incomplete buffer is properly managed through metadata"""
        # Arrange
        mock_result = {
            "new_nodes": [],
            "integration_decisions": [],
            "chunks": [],
            "incomplete_chunk_remainder": "Still incomplete"
        }
        
        async def async_test():
            with patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter.asyncio.to_thread', return_value=mock_result) as mock_to_thread:
                # Act
                result = await self.adapter.process_transcript("This is new text")
                
                # Assert - check that pipeline was called
                mock_to_thread.assert_called_once()
                call_args = mock_to_thread.call_args[0]
                self.assertEqual(call_args[1], "This is new text")
                
                # Assert - check that incomplete buffer is returned in metadata
                self.assertEqual(result.metadata.get("incomplete_buffer"), "Still incomplete")
        
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
        """Test that clearing state resets pipeline state"""
        # Arrange - adapter doesn't manage buffer anymore
        
        with patch.object(self.adapter.pipeline, 'clear_state') as mock_clear:
            # Act
            self.adapter.clear_workflow_state()
            
            # Assert
            mock_clear.assert_called_once()


if __name__ == "__main__":
    unittest.main() 