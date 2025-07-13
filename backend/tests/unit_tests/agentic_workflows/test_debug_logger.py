"""
Unit tests for debug logger
"""

import pytest
from unittest.mock import patch, MagicMock, Mock
from pathlib import Path
from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import (
    clear_debug_logs,
    log_stage_input_output,
    DEBUG_DIR
)


class TestDebugLogger:
    """Test suite for debug logger functions"""
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger.DEBUG_DIR')
    def test_clear_debug_logs_with_existing_files(self, mock_debug_dir):
        """Test clearing debug logs when files exist"""
        # Create mock files
        mock_file1 = Mock()
        mock_file2 = Mock()
        
        # Setup mock DEBUG_DIR
        mock_debug_dir.exists.return_value = True
        mock_debug_dir.glob.return_value = [mock_file1, mock_file2]
        
        # Call the function
        clear_debug_logs()
        
        # Verify files were deleted
        mock_file1.unlink.assert_called_once()
        mock_file2.unlink.assert_called_once()

    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger.DEBUG_DIR')
    def test_clear_debug_logs_no_directory(self, mock_debug_dir):
        """Test clearing debug logs when directory doesn't exist"""
        # Setup mock DEBUG_DIR to not exist
        mock_debug_dir.exists.return_value = False
        
        # Call the function - should not raise any errors
        clear_debug_logs()
        
        # Verify glob was not called since directory doesn't exist
        mock_debug_dir.glob.assert_not_called()

    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger.DEBUG_DIR')
    @patch('builtins.open', create=True)
    @patch('backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger.datetime')
    def test_log_stage_input_output(self, mock_datetime, mock_open, mock_debug_dir):
        """Test logging stage input and output"""
        # Setup mocks
        mock_datetime.now.return_value.strftime.return_value = "12:00:00"
        mock_file = MagicMock()
        mock_open.return_value.__enter__.return_value = mock_file
        
        # Mock DEBUG_DIR / operator
        mock_log_file = Mock()
        mock_log_file.name = "test_stage_debug.txt"
        mock_debug_dir.__truediv__.return_value = mock_log_file
        
        # Test data
        inputs = {"transcript": "test input"}
        outputs = {"result": "test output"}
        
        # Call the function
        log_stage_input_output("test_stage", inputs, outputs)
        
        # Verify file was opened with correct path
        mock_open.assert_called_once_with(mock_log_file, 'a', encoding='utf-8')
        
        # Verify write was called (checking the format would be too specific)
        mock_file.write.assert_called_once()
        
        # Get the actual written content
        written_content = mock_file.write.call_args[0][0]
        
        # Verify key elements are in the written content
        assert "TEST_STAGE STAGE DEBUG - 12:00:00" in written_content
        assert "INPUT VARIABLES:" in written_content
        assert "transcript: 'test input'" in written_content
        assert "OUTPUT VARIABLES:" in written_content
        assert "result: 'test output'" in written_content
