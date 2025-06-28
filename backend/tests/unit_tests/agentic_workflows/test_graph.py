"""
Unit tests for the VoiceTree graph workflow
"""

import pytest
from unittest.mock import Mock, patch, MagicMock

from backend.text_to_graph_pipeline.agentic_workflows.graph import (
    should_continue,
    create_voicetree_graph,
    compile_voicetree_graph,
    STAGE_TRANSITIONS
)

# The actual END value when langgraph is available
LANGGRAPH_END = "__end__"


class TestShouldContinue:
    """Test suite for should_continue function"""
    
    def test_returns_next_stage_for_segmentation_complete(self):
        state = {"current_stage": "segmentation_complete"}
        result = should_continue(state)
        assert result == "relationship_analysis"
    
    def test_returns_next_stage_for_relationship_analysis_complete(self):
        state = {"current_stage": "relationship_analysis_complete"}
        result = should_continue(state)
        assert result == "integration_decision"
    
    def test_returns_end_for_integration_decision_complete(self):
        state = {"current_stage": "integration_decision_complete"}
        result = should_continue(state)
        assert result == LANGGRAPH_END
    
    def test_returns_end_for_complete_stage(self):
        state = {"current_stage": "complete"}
        result = should_continue(state)
        assert result == LANGGRAPH_END
    
    def test_returns_end_for_error_stage(self):
        state = {"current_stage": "error"}
        result = should_continue(state)
        assert result == LANGGRAPH_END
    
    def test_returns_segmentation_for_unknown_stage(self):
        state = {"current_stage": "unknown_stage"}
        result = should_continue(state)
        assert result == "segmentation"
    
    def test_returns_segmentation_when_no_current_stage(self):
        state = {}
        result = should_continue(state)
        assert result == "segmentation"


class TestCreateVoiceTreeGraph:
    """Test suite for create_voicetree_graph function"""
    
    def test_returns_state_graph(self):
        from backend.text_to_graph_pipeline.agentic_workflows.graph import StateGraph
        
        result = create_voicetree_graph()
        assert isinstance(result, StateGraph)
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.StateGraph')
    def test_creates_state_graph_with_voicetree_state(self, mock_state_graph):
        from backend.text_to_graph_pipeline.agentic_workflows.state import VoiceTreeState
        mock_workflow = Mock()
        mock_state_graph.return_value = mock_workflow
        
        create_voicetree_graph()
        
        # Should use VoiceTreeState for type safety
        mock_state_graph.assert_called_once_with(VoiceTreeState)
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.StateGraph')
    def test_adds_all_three_nodes(self, mock_state_graph):
        mock_workflow = Mock()
        mock_state_graph.return_value = mock_workflow
        
        create_voicetree_graph()
        
        # Verify all three nodes are added
        assert mock_workflow.add_node.call_count == 3
        
        # Check the specific nodes added
        calls = mock_workflow.add_node.call_args_list
        node_names = [call[0][0] for call in calls]
        assert "segmentation" in node_names
        assert "relationship_analysis" in node_names
        assert "integration_decision" in node_names
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.StateGraph')
    def test_sets_segmentation_as_entry_point(self, mock_state_graph):
        mock_workflow = Mock()
        mock_state_graph.return_value = mock_workflow
        
        create_voicetree_graph()
        
        mock_workflow.set_entry_point.assert_called_once_with("segmentation")
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.StateGraph')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.END', 'END')
    def test_adds_conditional_edges_for_all_stages(self, mock_state_graph):
        mock_workflow = Mock()
        mock_state_graph.return_value = mock_workflow
        
        create_voicetree_graph()
        
        # Should add conditional edges for all 3 stages
        assert mock_workflow.add_conditional_edges.call_count == 3
        
        # Verify edge configurations
        calls = mock_workflow.add_conditional_edges.call_args_list
        
        # First stage (segmentation) should have edge to relationship_analysis and END
        assert calls[0][0][0] == "segmentation"
        assert calls[0][0][2] == {"relationship_analysis": "relationship_analysis", "END": "END"}
        
        # Second stage (relationship_analysis) should have edge to integration_decision and END
        assert calls[1][0][0] == "relationship_analysis"
        assert calls[1][0][2] == {"integration_decision": "integration_decision", "END": "END"}
        
        # Last stage (integration_decision) should only have edge to END
        assert calls[2][0][0] == "integration_decision"
        assert calls[2][0][2] == {"END": "END"}
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.StateGraph')
    def test_returns_configured_workflow(self, mock_state_graph):
        mock_workflow = Mock()
        mock_state_graph.return_value = mock_workflow
        
        result = create_voicetree_graph()
        
        assert result == mock_workflow


class TestCompileVoiceTreeGraph:
    """Test suite for compile_voicetree_graph function"""
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.create_voicetree_graph')
    def test_calls_create_voicetree_graph(self, mock_create):
        mock_workflow = Mock()
        mock_create.return_value = mock_workflow
        
        compile_voicetree_graph()
        
        mock_create.assert_called_once()
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.graph.create_voicetree_graph')
    def test_compiles_and_returns_workflow(self, mock_create):
        mock_workflow = Mock()
        mock_compiled = Mock()
        mock_workflow.compile.return_value = mock_compiled
        mock_create.return_value = mock_workflow
        
        result = compile_voicetree_graph()
        
        mock_workflow.compile.assert_called_once()
        assert result == mock_compiled


class TestStageTransitions:
    """Test suite for STAGE_TRANSITIONS constant"""
    
    def test_stage_transitions_mapping_is_complete(self):
        expected_transitions = {
            "segmentation_complete": "relationship_analysis",
            "relationship_analysis_complete": "integration_decision",
            "integration_decision_complete": LANGGRAPH_END,
            "complete": LANGGRAPH_END,
            "error": LANGGRAPH_END
        }
        assert STAGE_TRANSITIONS == expected_transitions