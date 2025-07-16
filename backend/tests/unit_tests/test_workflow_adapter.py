import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowAdapter, WorkflowResult
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.text_to_graph_pipeline.tree_manager.tree_functions import get_node_summaries
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision


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
        
        self.adapter = WorkflowAdapter(self.decision_tree)
    
    def test_initialization_creates_proper_adapter(self):
        """Test that WorkflowAdapter initializes with correct properties"""
        # Arrange & Act done in setUp
        
        # Assert
        self.assertEqual(self.adapter.decision_tree, self.decision_tree)
        self.assertIsNotNone(self.adapter.agent)
        self.assertIsNone(self.adapter.state_manager)  # No state file provided
    
    def test_get_node_summaries(self):
        """Test that node summaries are properly formatted"""
        # Act
        summaries = get_node_summaries(self.adapter.decision_tree)
        
        # Assert
        self.assertIsInstance(summaries, str)
        # Should contain our test nodes
        self.assertIn("Parent Node", summaries)
        self.assertIn("Test Node", summaries)
        self.assertIn("Parent summary", summaries)
        self.assertIn("Test summary", summaries)
    
    def test_process_transcript_converts_to_integration_decisions(self):
        """Test that workflow result properly converts to IntegrationDecision objects"""
        # Arrange
        mock_result = {
            "integration_decisions": [
                {
                    "action": "CREATE",
                    "new_node_name": "New Concept",
                    "target_node": "Root",
                    "relationship_for_edge": "child of",
                    "content": "New content",
                    "new_node_summary": "New summary",
                    "name": "chunk1",
                    "text": "test text",
                    "reasoning": "test reasoning"
                }
            ],
            "chunks": []
        }
        
        async def async_test():
            with patch.object(self.adapter.agent, 'run', return_value=mock_result):
                # Act
                result = await self.adapter.process_transcript("Test transcript")
                
                # Assert
                self.assertEqual(len(result.integration_decisions), 1)
                decision = result.integration_decisions[0]
                self.assertIsInstance(decision, IntegrationDecision)
                self.assertEqual(decision.action, "CREATE")
                self.assertEqual(decision.new_node_name, "New Concept")
                self.assertEqual(decision.target_node, "Root")
                self.assertEqual(decision.relationship_for_edge, "child of")
                self.assertEqual(decision.content, "New content")
                self.assertEqual(decision.new_node_summary, "New summary")
                self.assertEqual(decision.name, "chunk1")
        
        asyncio.run(async_test())
    
    def test_process_transcript_handles_append_decisions(self):
        """Test handling of APPEND workflow decisions"""
        # Arrange
        mock_result = {
            "integration_decisions": [
                {
                    "action": "APPEND",
                    "target_node": "Test Node",
                    "content": "Additional content",
                    "name": "chunk2",
                    "text": "test text",
                    "reasoning": "test reasoning",
                    "new_node_name": None,
                    "new_node_summary": None,
                    "relationship_for_edge": None
                }
            ],
            "chunks": []
        }
        
        async def async_test():
            with patch.object(self.adapter.agent, 'run', return_value=mock_result):
                # Act
                result = await self.adapter.process_transcript("Test transcript")
                
                # Assert
                self.assertEqual(len(result.integration_decisions), 1)
                decision = result.integration_decisions[0]
                self.assertIsInstance(decision, IntegrationDecision)
                self.assertEqual(decision.action, "APPEND")
                self.assertEqual(decision.target_node, "Test Node")
                self.assertEqual(decision.content, "Additional content")
                self.assertIsNone(decision.new_node_name)
        
        asyncio.run(async_test())
    
    
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
                "name": "chunk1",
                "text": "test text",
                "reasoning": "test reasoning"
            }],
            "chunks": [{"name": "chunk1", "text": "test text", "is_complete": True}]
        }
        
        async def async_test():
            with patch.object(self.adapter.agent, 'run', return_value=mock_result):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertTrue(result.success)
                self.assertEqual(result.new_nodes, ["New Concept"])
                self.assertEqual(len(result.integration_decisions), 1)
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
            with patch.object(self.adapter.agent, 'run', return_value=mock_result):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertFalse(result.success)
                self.assertEqual(result.error_message, "Workflow failed due to LLM timeout")
                self.assertEqual(result.new_nodes, [])
                self.assertEqual(result.integration_decisions, [])
        
        asyncio.run(async_test())
    
    def test_process_transcript_handles_exception(self):
        """Test handling of exceptions during workflow execution"""
        async def async_test():
            with patch.object(self.adapter.agent, 'run', side_effect=Exception("Pipeline crashed")):
                # Act
                result = await self.adapter.process_transcript("This is a test")
                
                # Assert
                self.assertFalse(result.success)
                self.assertIn("Workflow execution failed", result.error_message)
                self.assertIn("Pipeline crashed", result.error_message)
        
        asyncio.run(async_test())
    
    def test_process_transcript_without_incomplete_buffer(self):
        """Test that workflow runs without incomplete buffer tracking"""
        # Arrange
        mock_result = {
            "new_nodes": [],
            "integration_decisions": [],
            "chunks": []
        }
        
        async def async_test():
            with patch.object(self.adapter.agent, 'run', return_value=mock_result) as mock_run:
                # Act
                result = await self.adapter.process_transcript("This is new text")
                
                # Assert - check that agent was called
                mock_run.assert_called_once()
                call_kwargs = mock_run.call_args[1]
                self.assertEqual(call_kwargs['transcript'], "This is new text")
                
                # Assert - check that no incomplete buffer in metadata
                self.assertNotIn("incomplete_buffer", result.metadata)
        
        asyncio.run(async_test())
    
    
    def test_get_workflow_statistics_without_state_manager(self):
        """Test that statistics retrieval returns error when no state manager"""
        # Act
        stats = self.adapter.get_workflow_statistics()
        
        # Assert
        self.assertIn("error", stats)
        self.assertEqual(stats["error"], "No state manager configured")
    
    def test_clear_workflow_state_without_state_manager(self):
        """Test that clearing state works even without state manager"""
        # Act - should not raise an exception
        self.adapter.clear_workflow_state()
        
        # Assert - nothing to assert, just ensuring no exception


if __name__ == "__main__":
    unittest.main() 