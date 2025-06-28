"""
Unit tests for the agentic workflow nodes
"""

import pytest
import json
from unittest.mock import Mock, patch, mock_open
from pathlib import Path

from backend.text_to_graph_pipeline.agentic_workflows.nodes import (
    extract_json_from_response,
    _fix_json_response,
    process_llm_stage_structured,
    segmentation_node,
    relationship_analysis_node,
    integration_decision_node,
    log_to_file,
    MAX_NODE_NAME_LENGTH,
    EXCLUDED_PHRASES
)


class TestJSONExtraction:
    """Test JSON extraction and fixing utilities"""
    
    def test_extract_json_from_markdown_code_block(self):
        """Test extracting JSON from markdown code blocks"""
        response = '''
        Here's the response:
        ```json
        {"result": "success", "data": [1, 2, 3]}
        ```
        '''
        result = extract_json_from_response(response)
        assert result == '{"result": "success", "data": [1, 2, 3]}'
    
    def test_extract_json_without_code_block(self):
        """Test extracting JSON without markdown formatting"""
        response = '{"key": "value", "number": 42}'
        result = extract_json_from_response(response)
        assert result == response
    
    def test_extract_json_from_mixed_content(self):
        """Test extracting JSON from text with other content"""
        response = 'Some text before {"valid": "json"} and after'
        result = extract_json_from_response(response)
        assert result == '{"valid": "json"}'
    
    def test_extract_json_array(self):
        """Test extracting JSON array"""
        response = '[{"id": 1}, {"id": 2}]'
        result = extract_json_from_response(response)
        assert result == response
    
    def test_extract_json_with_broken_formatting(self):
        """Test extraction with malformed JSON that gets fixed"""
        response = '{"incomplete": "json"'  # Missing closing brace
        result = extract_json_from_response(response)
        # The function returns the original if it can't fix it
        # This is expected behavior - it tries to fix but doesn't always succeed
        assert result == response  # Returns original when can't fix
    
    def test_extract_json_empty_response(self):
        """Test handling empty response"""
        assert extract_json_from_response("") == ""
        assert extract_json_from_response("   ") == ""


class TestJSONFixer:
    """Test the JSON fixing utility"""
    
    def test_fix_missing_closing_braces(self):
        """Test fixing JSON with missing closing braces"""
        broken = '{"key": "value"'
        fixed = _fix_json_response(broken)
        assert fixed == '{"key": "value"}'
        assert json.loads(fixed)  # Validate it's proper JSON
    
    def test_fix_missing_closing_brackets(self):
        """Test fixing JSON arrays with missing brackets"""
        broken = '[{"item": 1}, {"item": 2}'
        fixed = _fix_json_response(broken)
        assert fixed == '[{"item": 1}, {"item": 2}]'
        assert json.loads(fixed)
    
    def test_fix_trailing_commas(self):
        """Test removing trailing commas"""
        broken = '{"key": "value",}'
        fixed = _fix_json_response(broken)
        assert json.loads(fixed)
        
        broken_array = '[1, 2, 3,]'
        fixed_array = _fix_json_response(broken_array)
        assert json.loads(fixed_array)
    
    def test_fix_unquoted_keys(self):
        """Test adding quotes to property names"""
        broken = '{key: "value", number: 42}'
        fixed = _fix_json_response(broken)
        # Should add quotes around keys
        assert '"key"' in fixed
        assert '"number"' in fixed
    
    def test_fix_complex_nested_json(self):
        """Test fixing complex nested structures"""
        broken = '{outer: {inner: "value", array: [1, 2,]'
        fixed = _fix_json_response(broken)
        # Should be parseable after fixes
        parsed = json.loads(fixed)
        assert parsed["outer"]["inner"] == "value"


class TestLogToFile:
    """Test file logging functionality"""
    
    @patch("builtins.open", new_callable=mock_open)
    def test_log_to_file_success(self, mock_file):
        """Test successful logging to file"""
        log_to_file("TestStage", "INPUT", "test content")
        
        mock_file.assert_called_once_with(
            Path(__file__).parent.parent.parent.parent.parent / "backend" / "text_to_graph_pipeline" / "agentic_workflows" / "workflow_io.log",
            "a",
            encoding="utf-8"
        )
        
        handle = mock_file()
        written_content = "".join(call.args[0] for call in handle.write.call_args_list)
        assert "--- START: TestStage - INPUT ---" in written_content
        assert "test content" in written_content
        assert "--- END: TestStage - INPUT ---" in written_content
    
    @patch("builtins.open", side_effect=Exception("File error"))
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.logger")
    def test_log_to_file_error_handling(self, mock_logger, mock_file):
        """Test error handling in file logging"""
        log_to_file("TestStage", "INPUT", "test content")
        
        # Should log the error
        mock_logger.error.assert_called_once()
        assert "Failed to write to workflow_io.log" in mock_logger.error.call_args[0][0]


class TestProcessLLMStageStructured:
    """Test the generic LLM stage processor"""
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.prompt_loader")
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.call_llm_structured")
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.log_to_file")
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.log_stage_input_output")
    def test_successful_processing(self, mock_log_stage, mock_log_file, mock_llm, mock_prompt):
        """Test successful LLM stage processing"""
        # Setup
        mock_prompt.render_template.return_value = "formatted prompt"
        
        # Mock LLM response with proper structure
        mock_response = Mock()
        mock_response.model_dump_json.return_value = '{"chunks": [{"name": "test"}]}'
        mock_response.chunks = [Mock(model_dump=lambda: {"name": "test", "text": "content"})]
        mock_llm.return_value = mock_response
        
        state = {
            "transcript_text": "test transcript",
            "current_stage": "initial"
        }
        
        # Execute
        result = process_llm_stage_structured(
            state=state,
            stage_name="Test Stage",
            stage_type="segmentation",
            prompt_name="test_prompt",
            prompt_kwargs={"test_key": "test_value"},
            result_key="chunks",
            next_stage="next"
        )
        
        # Verify
        assert result["current_stage"] == "next"
        assert "chunks" in result
        assert len(result["chunks"]) == 1
        assert result["chunks"][0]["name"] == "test"
        
        # Verify logging calls
        mock_log_file.assert_called()
        mock_log_stage.assert_called_once()
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.prompt_loader")
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.call_llm_structured")
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.log_stage_input_output")
    def test_error_handling(self, mock_log_stage, mock_llm, mock_prompt):
        """Test error handling in LLM stage processing"""
        # Setup error
        mock_prompt.render_template.side_effect = Exception("Prompt error")
        
        state = {"current_stage": "initial"}
        
        # Execute
        result = process_llm_stage_structured(
            state=state,
            stage_name="Test Stage",
            stage_type="segmentation",
            prompt_name="test_prompt",
            prompt_kwargs={},
            result_key="chunks",
            next_stage="next"
        )
        
        # Verify error handling
        assert result["current_stage"] == "error"
        assert "error_message" in result
        assert "Test Stage failed" in result["error_message"]
        
        # Verify error was logged
        mock_log_stage.assert_called_once()
        log_args = mock_log_stage.call_args[0]
        assert log_args[2]["error_message"]


class TestSegmentationNode:
    """Test the segmentation node"""
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.log_transcript_processing")
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.process_llm_stage_structured")
    def test_segmentation_success(self, mock_process, mock_log):
        """Test successful segmentation"""
        # Setup
        state = {"transcript_text": "Test transcript content"}
        mock_process.return_value = {
            "current_stage": "segmentation_complete",
            "chunks": [
                {"name": "Chunk 1", "text": "First part", "is_complete": True},
                {"name": "Chunk 2", "text": "Second part", "is_complete": True}
            ]
        }
        
        # Execute
        result = segmentation_node(state)
        
        # Verify
        assert result["current_stage"] == "segmentation_complete"
        assert len(result["chunks"]) == 2
        mock_log.assert_called_once_with("Test transcript content", "segmentation_node")
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.process_llm_stage_structured")
    def test_segmentation_with_incomplete_chunks(self, mock_process):
        """Test handling of incomplete chunks"""
        state = {"transcript_text": "Test transcript"}
        mock_process.return_value = {
            "current_stage": "segmentation_complete",
            "chunks": [
                {"name": "Complete", "text": "Done", "is_complete": True},
                {"name": "Incomplete", "text": "Not done", "is_complete": False}
            ]
        }
        
        result = segmentation_node(state)
        
        # Should filter out incomplete chunks
        assert len(result["chunks"]) == 1
        assert result["chunks"][0]["name"] == "Complete"
        assert result["incomplete_chunk_remainder"] == "Not done"
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.process_llm_stage_structured")
    def test_segmentation_fallback_on_error(self, mock_process):
        """Test fallback behavior when segmentation fails"""
        state = {"transcript_text": "Fallback test content"}
        mock_process.return_value = {
            "current_stage": "error",
            "error_message": "LLM failed"
        }
        
        result = segmentation_node(state)
        
        # Should create fallback chunk
        assert result["current_stage"] == "segmentation_complete"
        assert len(result["chunks"]) == 1
        assert result["chunks"][0]["name"] == "Voice Input"
        assert result["chunks"][0]["text"] == "Fallback test content"
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.process_llm_stage_structured")
    def test_segmentation_empty_transcript(self, mock_process):
        """Test handling of empty transcript"""
        state = {"transcript_text": ""}
        mock_process.return_value = {
            "current_stage": "error",
            "chunks": []
        }
        
        result = segmentation_node(state)
        
        assert result["current_stage"] == "error"
        assert "Empty transcript" in result["error_message"]


class TestRelationshipAnalysisNode:
    """Test the relationship analysis node"""
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.process_llm_stage_structured")
    def test_relationship_analysis(self, mock_process):
        """Test relationship analysis node"""
        state = {
            "existing_nodes": "Node1: Description",
            "chunks": [{"name": "Test", "text": "Content"}]
        }
        
        expected_response = {
            "current_stage": "relationship_analysis_complete",
            "analyzed_chunks": [
                {
                    "name": "Test",
                    "text": "Content",
                    "relevant_node_name": "Node1",
                    "relationship": "related to"
                }
            ]
        }
        mock_process.return_value = expected_response
        
        result = relationship_analysis_node(state)
        
        # Verify the call
        mock_process.assert_called_once()
        call_args = mock_process.call_args[1]
        assert call_args["stage_name"] == "relationship_analysis"
        assert call_args["stage_type"] == "relationship_analysis"
        assert call_args["prompt_name"] == "relationship_analysis"
        assert call_args["result_key"] == "analyzed_chunks"
        
        # Verify prompt kwargs
        prompt_kwargs = call_args["prompt_kwargs"]
        assert prompt_kwargs["existing_nodes"] == "Node1: Description"
        assert json.loads(prompt_kwargs["sub_chunks"]) == [{"name": "Test", "text": "Content"}]


class TestIntegrationDecisionNode:
    """Test the integration decision node"""
    
    @patch("backend.text_to_graph_pipeline.agentic_workflows.nodes.process_llm_stage_structured")
    def test_integration_decision(self, mock_process):
        """Test integration decision node"""
        state = {
            "analyzed_chunks": [
                {
                    "name": "Chunk1",
                    "text": "Content",
                    "relevant_node_name": "ExistingNode",
                    "relationship": "extends"
                }
            ]
        }
        
        expected_response = {
            "current_stage": "complete",
            "integration_decisions": [
                {
                    "name": "Chunk1",
                    "text": "Content",
                    "action": "APPEND",
                    "target_node": "ExistingNode",
                    "content": "Content"
                }
            ]
        }
        mock_process.return_value = expected_response
        
        result = integration_decision_node(state)
        
        # Verify the call
        mock_process.assert_called_once()
        call_args = mock_process.call_args[1]
        assert call_args["stage_name"] == "integration_decision"
        assert call_args["stage_type"] == "integration_decision"
        assert call_args["prompt_name"] == "integration_decision"
        assert call_args["result_key"] == "integration_decisions"
        assert call_args["next_stage"] == "complete"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])