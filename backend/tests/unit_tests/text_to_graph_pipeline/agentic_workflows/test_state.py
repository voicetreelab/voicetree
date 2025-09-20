"""
Unit tests for the VoiceTree state schema and validation
"""

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.core.state import VoiceTreeState
from backend.text_to_graph_pipeline.agentic_workflows.core.state import validate_state


class TestVoiceTreeState:
    """Test suite for VoiceTreeState TypedDict"""
    
    def test_voicetree_state_has_required_fields(self):
        """Test that VoiceTreeState has all required fields defined"""
        # Get the annotations from the TypedDict
        annotations = VoiceTreeState.__annotations__
        
        # Required fields that must be present
        required_fields = {
            'transcript_text',
            'transcript_history',
            'existing_nodes',
            'chunks',
            'analyzed_chunks',
            'integration_decisions',
            'new_nodes',
            'current_stage',
            'error_message'
        }
        
        # Check all required fields are in the annotations
        for field in required_fields:
            assert field in annotations, f"Missing required field: {field}"
    
    def test_voicetree_state_field_types(self):
        """Test that fields have the correct types"""
        annotations = VoiceTreeState.__annotations__
        
        # Check specific field types
        assert annotations['transcript_text'] is str
        assert annotations['transcript_history'] is str
        assert annotations['existing_nodes'] is str
        assert annotations['current_stage'] is str


class TestValidateState:
    """Test suite for validate_state function"""
    
    def test_validate_state_with_valid_state(self):
        """Test that validation passes with all required fields"""
        valid_state = {
            'transcript_text': 'test',
            'transcript_history': 'history',
            'existing_nodes': 'nodes',
            'current_stage': 'start'
        }
        # Should not raise any exception
        validate_state(valid_state)
    
    def test_validate_state_automatically_detects_required_fields(self):
        """Test that validation automatically detects required vs optional fields"""
        # This state has all required fields but missing optional ones
        valid_state = {
            'transcript_text': 'test',
            'transcript_history': 'history', 
            'existing_nodes': 'nodes',
            'current_stage': 'start'
            # Missing optional fields: chunks, analyzed_chunks, etc
        }
        # Should not raise exception since optional fields can be omitted
        validate_state(valid_state)
    
    def test_validate_state_missing_transcript_text(self):
        """Test that validation fails when transcript_text is missing"""
        invalid_state = {
            'transcript_history': 'history',
            'existing_nodes': 'nodes',
            'current_stage': 'start'
        }
        with pytest.raises(KeyError) as exc_info:
            validate_state(invalid_state)
        assert 'transcript_text' in str(exc_info.value)
        assert 'Missing required state fields' in str(exc_info.value)
    
    def test_validate_state_missing_multiple_fields(self):
        """Test that validation reports all missing fields"""
        invalid_state = {
            'current_stage': 'start'
        }
        with pytest.raises(KeyError) as exc_info:
            validate_state(invalid_state)
        error_message = str(exc_info.value)
        assert 'transcript_text' in error_message
        assert 'transcript_history' in error_message
        assert 'existing_nodes' in error_message
        assert 'VoiceTreeState' in error_message
        assert 'pipeline.py' in error_message
    
    def test_validate_state_with_optional_fields(self):
        """Test that validation passes with optional fields as None"""
        valid_state = {
            'transcript_text': 'test',
            'transcript_history': 'history',
            'existing_nodes': 'nodes',
            'current_stage': 'start',
            'chunks': None,
            'analyzed_chunks': None,
            'error_message': None
        }
        # Should not raise any exception
        validate_state(valid_state)