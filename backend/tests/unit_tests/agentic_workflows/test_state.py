"""
Unit tests for the VoiceTree state management
"""

import pytest
from typing import Dict, Any

from backend.text_to_graph_pipeline.agentic_workflows.state import VoiceTreeState


class TestVoiceTreeState:
    """Test the VoiceTreeState TypedDict"""
    
    def test_state_creation(self):
        """Test creating a valid state object"""
        state: VoiceTreeState = {
            "transcript_text": "Test transcript",
            "existing_nodes": "Node1: Description",
            "incomplete_chunk_buffer": "Partial text",
            "chunks": [{"name": "chunk1", "text": "content"}],
            "analyzed_chunks": [{"name": "chunk1", "relationships": []}],
            "integration_decisions": [{"action": "CREATE"}],
            "new_nodes": ["NewNode1"],
            "incomplete_chunk_remainder": "Leftover",
            "current_stage": "complete",
            "error_message": None
        }
        
        # TypedDict allows dict operations
        assert state["transcript_text"] == "Test transcript"
        assert state["current_stage"] == "complete"
        assert len(state["chunks"]) == 1
    
    def test_state_partial_creation(self):
        """Test creating state with only required fields"""
        # In TypedDict with total=True (default), all fields are required
        # But our VoiceTreeState allows Optional fields
        minimal_state: VoiceTreeState = {
            "transcript_text": "Test",
            "existing_nodes": "",
            "incomplete_chunk_buffer": None,
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "incomplete_chunk_remainder": None,
            "current_stage": "initial",
            "error_message": None
        }
        
        assert minimal_state["transcript_text"] == "Test"
        assert minimal_state["chunks"] is None
    
    def test_state_update(self):
        """Test updating state values"""
        state: VoiceTreeState = {
            "transcript_text": "Initial",
            "existing_nodes": "",
            "incomplete_chunk_buffer": None,
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "incomplete_chunk_remainder": None,
            "current_stage": "initial",
            "error_message": None
        }
        
        # Update state
        state["current_stage"] = "segmentation_complete"
        state["chunks"] = [{"name": "chunk1", "text": "content"}]
        
        assert state["current_stage"] == "segmentation_complete"
        assert len(state["chunks"]) == 1
    
    def test_state_stage_progression(self):
        """Test typical stage progression values"""
        stages = [
            "initial",
            "segmentation_complete",
            "relationship_analysis_complete",
            "complete",
            "error"
        ]
        
        for stage in stages:
            state: VoiceTreeState = {
                "transcript_text": "",
                "existing_nodes": "",
                "incomplete_chunk_buffer": None,
                "chunks": None,
                "analyzed_chunks": None,
                "integration_decisions": None,
                "new_nodes": None,
                "incomplete_chunk_remainder": None,
                "current_stage": stage,
                "error_message": None
            }
            assert state["current_stage"] == stage
    
    def test_state_error_handling(self):
        """Test state with error information"""
        state: VoiceTreeState = {
            "transcript_text": "Test",
            "existing_nodes": "",
            "incomplete_chunk_buffer": None,
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "incomplete_chunk_remainder": None,
            "current_stage": "error",
            "error_message": "Processing failed: Invalid input"
        }
        
        assert state["current_stage"] == "error"
        assert "Processing failed" in state["error_message"]
    
    def test_state_type_annotations(self):
        """Test that type annotations work correctly"""
        # This test verifies the type hints are correct
        # It won't fail at runtime but helps IDEs and type checkers
        
        def process_state(state: VoiceTreeState) -> str:
            """Example function using VoiceTreeState type"""
            return state["current_stage"]
        
        test_state: VoiceTreeState = {
            "transcript_text": "Test",
            "existing_nodes": "",
            "incomplete_chunk_buffer": None,
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "incomplete_chunk_remainder": None,
            "current_stage": "test",
            "error_message": None
        }
        
        result = process_state(test_state)
        assert result == "test"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])