"""
Unit tests for the VoiceTree pipeline
"""

import pytest
from unittest.mock import Mock, patch, MagicMock, call
from typing import Dict, Any

from backend.text_to_graph_pipeline.agentic_workflows.pipeline import (
    VoiceTreePipeline,
    run_voicetree_pipeline
)


class TestVoiceTreePipeline:
    """Test suite for VoiceTreePipeline class"""
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_init_with_state_file(self, mock_compile, mock_state_manager):
        """Test initialization with state file"""
        mock_app = Mock()
        mock_compile.return_value = mock_app
        
        pipeline = VoiceTreePipeline("test_state.json")
        
        mock_state_manager.assert_called_once_with("test_state.json")
        mock_compile.assert_called_once()
        assert pipeline.app == mock_app
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_init_without_state_file(self, mock_compile, mock_state_manager):
        """Test initialization without state file"""
        mock_app = Mock()
        mock_compile.return_value = mock_app
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        
        pipeline = VoiceTreePipeline()
        
        mock_state_manager.assert_called_once_with(None)
        mock_compile.assert_called_once()
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_run_successful(self, mock_compile, mock_state_manager):
        """Test successful pipeline run"""
        # Setup mocks
        mock_app = Mock()
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        mock_state_manager_instance.get_node_summaries.return_value = "Node 1, Node 2"
        mock_state_manager_instance.nodes = {"Node 1": {}, "Node 2": {}}
        
        # Mock the app.invoke to return a successful state
        final_state = {
            "transcript_text": "test transcript",
            "chunks": ["chunk1", "chunk2"],
            "analyzed_chunks": ["analyzed1", "analyzed2"],
            "integration_decisions": [
                {"action": "CREATE", "new_node_name": "New Node 1"},
                {"action": "APPEND", "target_node": "Node 1"}
            ],
            "new_nodes": ["New Node 1"],
            "current_stage": "complete",
            "error_message": None
        }
        mock_app.invoke.return_value = final_state
        mock_compile.return_value = mock_app
        
        # Run pipeline
        pipeline = VoiceTreePipeline()
        result = pipeline.run("test transcript")
        
        # Verify
        assert result == final_state
        mock_app.invoke.assert_called_once()
        initial_state = mock_app.invoke.call_args[0][0]
        assert initial_state["transcript_text"] == "test transcript"
        assert initial_state["existing_nodes"] == "Node 1, Node 2"
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_run_with_error(self, mock_compile, mock_state_manager):
        """Test pipeline run with error"""
        # Setup mocks
        mock_app = Mock()
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        mock_state_manager_instance.get_node_summaries.return_value = ""
        
        # Mock the app.invoke to raise an exception
        mock_app.invoke.side_effect = Exception("Test error")
        mock_compile.return_value = mock_app
        
        # Run pipeline
        pipeline = VoiceTreePipeline()
        result = pipeline.run("test transcript")
        
        # Verify error handling
        assert result["current_stage"] == "error"
        assert result["error_message"] == "Test error"
        assert result["transcript_text"] == "test transcript"
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_run_extracts_new_nodes_from_decisions(self, mock_compile, mock_state_manager):
        """Test that new nodes are extracted from integration decisions"""
        # Setup mocks
        mock_app = Mock()
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        mock_state_manager_instance.get_node_summaries.return_value = ""
        mock_state_manager_instance.nodes = {}
        
        # Return state without new_nodes but with integration_decisions
        final_state = {
            "integration_decisions": [
                {"action": "CREATE", "new_node_name": "Node A"},
                {"action": "APPEND", "target_node": "Existing Node"},
                {"action": "CREATE", "new_node_name": "Node B"}
            ],
            # Don't include new_nodes key at all to trigger extraction
            "error_message": None
        }
        mock_app.invoke.return_value = final_state
        mock_compile.return_value = mock_app
        
        # Run pipeline
        pipeline = VoiceTreePipeline()
        result = pipeline.run("test")
        
        # Verify new nodes were extracted using the helper function
        assert "new_nodes" in result
        assert result["new_nodes"] == ["Node A", "Node B"]
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_run_updates_state_manager(self, mock_compile, mock_state_manager):
        """Test that state manager is updated with new nodes"""
        # Setup mocks
        mock_app = Mock()
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        mock_state_manager_instance.nodes = {}
        
        final_state = {
            "new_nodes": ["Node A", "Node B"],
            "error_message": None
        }
        mock_app.invoke.return_value = final_state
        mock_compile.return_value = mock_app
        
        # Run pipeline
        pipeline = VoiceTreePipeline()
        pipeline.run("test")
        
        # Verify state manager was updated
        mock_state_manager_instance.add_nodes.assert_called_once_with(
            ["Node A", "Node B"], 
            final_state
        )
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    def test_get_statistics_with_state_manager(self, mock_state_manager):
        """Test get_statistics with state manager"""
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        mock_state_manager_instance.get_statistics.return_value = {
            "total_nodes": 5,
            "sessions": 3
        }
        
        pipeline = VoiceTreePipeline()
        stats = pipeline.get_statistics()
        
        assert stats == {"total_nodes": 5, "sessions": 3}
        mock_state_manager_instance.get_statistics.assert_called_once()
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    def test_get_statistics_without_state_manager(self, mock_state_manager):
        """Test get_statistics returns valid stats"""
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        mock_state_manager_instance.get_statistics.return_value = {
            "total_nodes": 0,
            "total_executions": 0,
            "nodes_by_parent": {"root": 0},
            "recent_additions": []
        }
        
        pipeline = VoiceTreePipeline()
        stats = pipeline.get_statistics()
        
        # The state manager should be initialized and stats returned
        assert stats == {
            "total_nodes": 0,
            "total_executions": 0,
            "nodes_by_parent": {"root": 0},
            "recent_additions": []
        }
        assert stats["total_executions"] == 0
        mock_state_manager_instance.get_statistics.assert_called_once()

    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    def test_clear_state(self, mock_state_manager):
        """Test clear_state method"""
        mock_state_manager_instance = Mock()
        mock_state_manager.return_value = mock_state_manager_instance
        
        pipeline = VoiceTreePipeline()
        pipeline.clear_state()
        
        mock_state_manager_instance.clear_state.assert_called_once()
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreeStateManager')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.compile_voice_tree_agent')
    def test_print_results_summary(self, mock_compile, mock_state_manager):
        """Test _print_results_summary method"""
        pipeline = VoiceTreePipeline()
        
        state = {
            "chunks": ["c1", "c2", "c3"],
            "analyzed_chunks": ["a1", "a2"],
            "integration_decisions": ["d1", "d2", "d3", "d4"],
            "new_nodes": ["Node A", "Node B"]
        }
        
        # Should not raise any exceptions
        pipeline._print_results_summary(state)
        
        # Test with empty state
        pipeline._print_results_summary({})


class TestRunVoiceTreePipeline:
    """Test suite for run_voicetree_pipeline function"""
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreePipeline')
    def test_run_voicetree_pipeline_basic(self, mock_pipeline_class):
        """Test basic run_voicetree_pipeline functionality"""
        mock_pipeline = Mock()
        mock_pipeline_class.return_value = mock_pipeline
        mock_pipeline.run.return_value = {"result": "success"}
        
        result = run_voicetree_pipeline("test transcript")
        
        mock_pipeline_class.assert_called_once_with(None)
        mock_pipeline.run.assert_called_once_with("test transcript")
        assert result == {"result": "success"}
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.pipeline.VoiceTreePipeline')
    def test_run_voicetree_pipeline_with_state_file(self, mock_pipeline_class):
        """Test run_voicetree_pipeline with state file"""
        mock_pipeline = Mock()
        mock_pipeline_class.return_value = mock_pipeline
        
        run_voicetree_pipeline("test", state_file="state.json")
        
        mock_pipeline_class.assert_called_once_with("state.json")
    
