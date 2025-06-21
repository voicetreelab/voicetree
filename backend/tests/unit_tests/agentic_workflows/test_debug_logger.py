"""
Unit tests for debug logger
"""

import pytest
from unittest.mock import patch, MagicMock, Mock
from pathlib import Path
from backend.text_to_graph_pipeline.agentic_workflows.debug_logger import (
    clear_debug_logs,
    log_stage_input_output,
    DEBUG_DIR
)


class TestDebugLogger:
    """Test suite for debug logger functions"""
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.debug_logger.Path')
    def test_clear_debug_logs_with_existing_files(self, mock_path_class):
        """Test clearing debug logs when files exist"""
        # Setup mocks
        mock_debug_dir = Mock()
        mock_path_class.return_value = mock_debug_dir
        mock_debug_dir.__truediv__.return_value = mock_debug_dir
        mock_debug_dir.parent = mock_debug_dir
        
        # Mock the exists() to return True
        mock_debug_dir.exists.return_value = True
        
        # Create mock files
        mock_file1 = Mock()
        mock_file2 = Mock()
        mock_debug_dir.glob.return_value = [mock_file1, mock_file2]
        
        # Call the function
        clear_debug_logs()
        
        # Verify files were deleted
        mock_file1.unlink.assert_called_once()
        mock_file2.unlink.assert_called_once()
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.debug_logger.Path')
    def test_clear_debug_logs_no_directory(self, mock_path_class):
        """Test clearing debug logs when directory doesn't exist"""
        # Setup mocks
        mock_debug_dir = Mock()
        mock_path_class.return_value = mock_debug_dir
        mock_debug_dir.__truediv__.return_value = mock_debug_dir
        mock_debug_dir.parent = mock_debug_dir
        
        # Mock the exists() to return False
        mock_debug_dir.exists.return_value = False
        
        # Call the function - should not raise any errors
        clear_debug_logs()
        
        # Verify glob was not called since directory doesn't exist
        mock_debug_dir.glob.assert_not_called()
    
    @patch('backend.text_to_graph_pipeline.agentic_workflows.debug_logger.json.dump')
    @patch('builtins.open', create=True)
    @patch('backend.text_to_graph_pipeline.agentic_workflows.debug_logger.datetime')
    def test_log_stage_input_output(self, mock_datetime, mock_open, mock_json_dump):
        """Test logging stage input and output"""
        # Setup mocks
        mock_datetime.now.return_value.isoformat.return_value = "2024-01-01T12:00:00"
        mock_file = MagicMock()
        mock_open.return_value.__enter__.return_value = mock_file
        
        # Test data
        inputs = {"transcript": "test input"}
        outputs = {"result": "test output"}
        
        # Call the function
        log_stage_input_output("test_stage", inputs, outputs)
        
        # Verify file was opened with correct path
        expected_path = DEBUG_DIR / "test_stage_debug.txt"
        mock_open.assert_called_once_with(expected_path, 'a')
        
        # Verify correct data was written
        expected_log = {
            "timestamp": "2024-01-01T12:00:00",
            "stage": "test_stage",
            "inputs": inputs,
            "outputs": outputs
        }
        mock_json_dump.assert_called_once_with(expected_log, mock_file, indent=2)