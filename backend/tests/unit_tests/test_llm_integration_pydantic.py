"""
Unit tests for PydanticAI-based LLM integration
"""

import pytest
from unittest.mock import patch, MagicMock
from pydantic import BaseModel

from backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration import (
    call_llm, call_llm_structured, _get_api_key
)
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    SegmentationResponse, ChunkModel
)


class TestLLMIntegration:
    """Test suite for PydanticAI-based LLM integration"""

    def test_get_api_key_from_env(self):
        """Test API key retrieval from environment"""
        with patch.dict('os.environ', {'GOOGLE_API_KEY': 'test_key'}):
            assert _get_api_key() == 'test_key'

    @patch('backend.settings', create=True)
    def test_get_api_key_from_settings(self, mock_settings):
        """Test API key retrieval from settings when env var not set"""
        with patch.dict('os.environ', {}, clear=True):
            mock_settings.GOOGLE_API_KEY = 'settings_key'
            assert _get_api_key() == 'settings_key'

    def test_call_llm_structured_invalid_stage(self):
        """Test call_llm_structured with invalid stage type"""
        with pytest.raises(ValueError, match="Unknown stage type"):
            call_llm_structured("test prompt", "invalid_stage")

    def test_call_llm_structured_no_api_key(self):
        """Test call_llm_structured without API key"""
        with patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration._get_api_key', 
                  return_value=None):
            with pytest.raises(ValueError, match="No Google API key available"):
                call_llm_structured("test prompt", "segmentation")

    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration.Agent')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration.GeminiModel')
    def test_call_llm_structured_success(self, mock_model_class, mock_agent_class):
        """Test successful call_llm_structured"""
        # Mock the response
        mock_output = SegmentationResponse(
            chunks=[
                ChunkModel(
                    reasoning="Test reasoning for chunk segmentation",
                    name="test",
                    text="test text",
                    is_complete=True
                )
            ]
        )
        
        mock_result = MagicMock()
        mock_result.data = mock_output
        
        mock_agent = MagicMock()
        mock_agent.run_sync.return_value = mock_result
        mock_agent_class.return_value = mock_agent
        
        with patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration._get_api_key', 
                  return_value='test_key'):
            result = call_llm_structured("test prompt", "segmentation")
            
            # Verify the result
            assert isinstance(result, SegmentationResponse)
            assert len(result.chunks) == 1
            assert result.chunks[0].name == "test"
            
            # Verify API calls
            mock_model_class.assert_called_once_with("gemini-2.0-flash")
            mock_agent.run_sync.assert_called_once_with("test prompt")

    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration.Agent')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration.GeminiModel')
    def test_call_llm_success(self, mock_model_class, mock_agent_class):
        """Test successful call_llm"""
        # Mock the response
        mock_result = MagicMock()
        mock_result.data = "Test response from LLM"
        
        mock_agent = MagicMock()
        mock_agent.run_sync.return_value = mock_result
        mock_agent_class.return_value = mock_agent
        
        with patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration._get_api_key', 
                  return_value='test_key'):
            result = call_llm("test prompt")
            
            # Verify the result
            assert result == "Test response from LLM"
            
            # Verify API calls
            mock_model_class.assert_called_once_with("gemini-2.0-flash")
            mock_agent.run_sync.assert_called_once_with("test prompt")

    def test_call_llm_no_api_key(self):
        """Test call_llm without API key"""
        with patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration._get_api_key', 
                  return_value=None):
            with pytest.raises(ValueError, match="No Google API key available"):
                call_llm("test prompt")

    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration.Agent')
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration.GeminiModel')
    def test_call_llm_api_error(self, mock_model_class, mock_agent_class):
        """Test call_llm with API error"""
        mock_agent = MagicMock()
        mock_agent.run_sync.side_effect = Exception("API Error")
        mock_agent_class.return_value = mock_agent
        
        with patch('backend.text_to_graph_pipeline.agentic_workflows.core.llm_integration._get_api_key', 
                  return_value='test_key'):
            with pytest.raises(RuntimeError, match="Error calling Gemini API"):
                call_llm("test prompt")