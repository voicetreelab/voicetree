import asyncio
import logging
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from backend.text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree, Node
from backend.workflow_adapter import WorkflowResult
from backend.text_to_graph_pipeline.tree_manager import NodeAction


class TestChunkProcessor(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures"""
        self.decision_tree = DecisionTree()
        self.decision_tree.tree = {
            0: Node(name="Root", node_id=0, content="root content", summary="Root node", parent_id=None),
            1: Node(name="Test Node", node_id=1, content="test content", summary="Test summary", parent_id=0),
        }
        
        # Mock the VoiceTreePipeline to avoid external dependencies
        with patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreePipeline'):
            self.tree_manager = ChunkProcessor(
                decision_tree=self.decision_tree,
                workflow_state_file=None
            )
    
    def test_initialization_creates_workflow_adapter(self):
        """Test that ChunkProcessor properly initializes with workflow adapter"""
        # Arrange & Act done in setUp
        
        # Assert
        self.assertEqual(self.tree_manager.decision_tree, self.decision_tree)
        self.assertIsNotNone(self.tree_manager.workflow_adapter)
    
    def test_initialization_with_state_file_path(self):
        """Test initialization with workflow state file parameter"""
        # Arrange & Act
        with patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreePipeline'):
            tree_manager = ChunkProcessor(
                decision_tree=self.decision_tree,
                workflow_state_file="test_state.json"
            )
        
        # Assert
        self.assertIsNotNone(tree_manager.workflow_adapter)
    
    def test_process_text_chunk_delegates_to_workflow(self):
        """Test that _process_text_chunk delegates to workflow processing"""
        async def async_test():
            with patch.object(self.tree_manager, '_process_with_workflow') as mock_process_workflow:
                # Act
                await self.tree_manager._process_text_chunk("test text", "history context")
                
                # Assert
                mock_process_workflow.assert_called_once_with("test text", "history context")
        
        asyncio.run(async_test())
    
    def test_process_with_workflow_success_creates_nodes(self):
        """Test successful workflow processing calls adapter correctly"""
        # Arrange
        mock_result = WorkflowResult(
            success=True,
            new_nodes=["New Node"],
            node_actions=[NodeAction(
                action="CREATE",
                concept_name="New Node",
                neighbour_concept_name="Root",
                relationship_to_neighbour="child of",
                markdown_content_to_append="New content",
                updated_summary_of_node="New summary",
                is_complete=True,
                labelled_text="test"
            )],
            metadata={"chunks_processed": 1}
        )
        
        async def async_test():
            with patch.object(self.tree_manager.workflow_adapter, 'process_transcript', 
                             return_value=mock_result) as mock_process:
                # Act
                await self.tree_manager._process_with_workflow("test text", "history")
                
                # Assert - just verify the workflow adapter was called correctly
                mock_process.assert_called_once_with(transcript="test text", context="history")
        
        asyncio.run(async_test())
    
    def test_process_with_workflow_append_updates_existing_node(self):
        """Test workflow processing with APPEND action updates existing nodes"""
        # Arrange
        mock_result = WorkflowResult(
            success=True,
            new_nodes=[],
            node_actions=[NodeAction(
                action="APPEND",
                concept_name="Test Node",
                neighbour_concept_name=None,
                relationship_to_neighbour=None,
                markdown_content_to_append="Additional content",
                updated_summary_of_node="Updated summary",
                is_complete=True,
                labelled_text="test"
            )]
        )
        
        async def async_test():
            with patch.object(self.tree_manager.workflow_adapter, 'process_transcript', 
                             return_value=mock_result):
                # Act
                await self.tree_manager._process_with_workflow("test text", "history")
                
                # Assert
                # Should track updated nodes (this is what we can reliably test)
                self.assertIn(1, self.tree_manager.nodes_to_update)
        
        asyncio.run(async_test())
    
    def test_process_with_workflow_handles_failure_gracefully(self):
        """Test that workflow failures are handled without crashing"""
        # Arrange
        mock_result = WorkflowResult(
            success=False,
            new_nodes=[],
            node_actions=[],
            error_message="Workflow failed"
        )
        
        async def async_test():
            with patch.object(self.tree_manager.workflow_adapter, 'process_transcript', 
                             return_value=mock_result):
                # Act - should not raise exception
                await self.tree_manager._process_with_workflow("test text", "history")
                
                # Assert - no nodes should be updated
                self.assertEqual(len(self.tree_manager.nodes_to_update), 0)
        
        asyncio.run(async_test())
    
    def test_get_workflow_statistics_delegates_to_adapter(self):
        """Test that workflow statistics retrieval delegates to adapter"""
        # Arrange
        expected_stats = {"total_nodes": 10, "total_executions": 5}
        
        with patch.object(self.tree_manager.workflow_adapter, 'get_workflow_statistics', 
                         return_value=expected_stats) as mock_get_stats:
            # Act
            stats = self.tree_manager.get_workflow_statistics()
            
            # Assert
            self.assertEqual(stats, expected_stats)
            mock_get_stats.assert_called_once()
    
    def test_clear_workflow_state_delegates_to_adapter(self):
        """Test that clearing workflow state delegates to adapter"""
        with patch.object(self.tree_manager.workflow_adapter, 'clear_workflow_state') as mock_clear:
            # Act
            self.tree_manager.clear_workflow_state()
            
            # Assert
            mock_clear.assert_called_once()
    
    def test_process_voice_input_integrates_with_workflow(self):
        """Test that process_voice_input properly integrates with workflow processing"""
        # Arrange  
        mock_result = WorkflowResult(
            success=True,
            new_nodes=["Test Concept"],
            node_actions=[]
        )
        
        async def async_test():
            with patch.object(self.tree_manager.workflow_adapter, 'process_transcript', 
                             return_value=mock_result) as mock_process:
                # Use a small threshold manager for testing
                from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig
                test_config = BufferConfig(buffer_size_threshold=10)
                self.tree_manager.buffer_manager = TextBufferManager(config=test_config)
                
                # Act
                logging.info("TEST: About to call process_voice_input from test")
                await self.tree_manager.process_voice_input("This is a test sentence.")
                logging.info("TEST: Finished calling process_voice_input from test")
                
                # Assert - should have called the workflow when threshold is met
                # Just verify the adapter method was called
                self.assertTrue(mock_process.called)
        
        asyncio.run(async_test())
    
    def test_voice_input_below_threshold_does_not_trigger_workflow(self):
        """Test that voice input below threshold doesn't trigger workflow processing"""
        async def async_test():
            with patch.object(self.tree_manager.workflow_adapter, 'process_transcript') as mock_process:
                # Use a high threshold manager for testing
                from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig
                test_config = BufferConfig(buffer_size_threshold=100)
                self.tree_manager.buffer_manager = TextBufferManager(config=test_config)
                
                # Act
                await self.tree_manager.process_voice_input("Short text")
                
                # Assert
                # Should not call workflow processing
                mock_process.assert_not_called()
                # Text should be buffered (check buffer stats)
                stats = self.tree_manager.buffer_manager.get_stats()
                self.assertGreater(stats['text_buffer_size'], 0)
        
        asyncio.run(async_test())
    
    def test_background_rewrite_integration_with_workflow(self):
        """Test that background rewrite works with workflow processing"""
        # Arrange
        # This test verifies that the workflow tree manager still supports background rewriting
        # when nodes are appended to multiple times
        mock_result = WorkflowResult(
            success=True,
            new_nodes=[],
            node_actions=[NodeAction(
                action="APPEND",
                concept_name="Test Node",
                neighbour_concept_name=None,
                relationship_to_neighbour=None,
                markdown_content_to_append="Content",
                updated_summary_of_node="Summary",
                is_complete=True,
                labelled_text="test"
            )]
        )
        
        async def async_test():
            with patch.object(self.tree_manager.workflow_adapter, 'process_transcript', 
                             return_value=mock_result):
                # Act
                await self.tree_manager._process_with_workflow("test text", "history")
                
                # Assert - node should be tracked for updates
                self.assertIn(1, self.tree_manager.nodes_to_update)
        
        asyncio.run(async_test())


if __name__ == "__main__":
    unittest.main() 