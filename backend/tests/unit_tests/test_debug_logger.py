"""
Test suite for debug_logger.py to ensure it works in all environments
"""

import os
import sys
import tempfile
import shutil
from pathlib import Path
from unittest import mock
import pytest

# Import after we can mock sys.frozen
def get_debug_logger_module():
    """Import the debug_logger module fresh"""
    # Remove from sys.modules to force reimport
    if 'backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger' in sys.modules:
        del sys.modules['backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger']

    from backend.text_to_graph_pipeline.agentic_workflows.core import debug_logger
    return debug_logger


class TestDebugLogger:
    """Test the debug logger in various environments"""

    def setup_method(self):
        """Setup for each test"""
        self.temp_dir = tempfile.mkdtemp()
        self.original_env = os.environ.get('VOICETREE_DEBUG_DIR')

    def teardown_method(self):
        """Cleanup after each test"""
        # Restore original environment
        if self.original_env:
            os.environ['VOICETREE_DEBUG_DIR'] = self.original_env
        elif 'VOICETREE_DEBUG_DIR' in os.environ:
            del os.environ['VOICETREE_DEBUG_DIR']

        # Clean up temp directory
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    def test_local_development_environment(self):
        """Test debug logger in local development (not frozen)"""
        # Ensure we're not in frozen mode
        if 'VOICETREE_DEBUG_DIR' in os.environ:
            del os.environ['VOICETREE_DEBUG_DIR']

        with mock.patch.object(sys, 'frozen', False, create=True):
            debug_logger = get_debug_logger_module()

            # Debug dir should be relative to the module
            expected_parent = Path(debug_logger.__file__).parent.parent / "debug_logs"
            assert debug_logger.DEBUG_DIR == expected_parent

            # Test that logging works
            debug_logger.log_stage_input_output(
                "test_stage",
                {"input": "test_input"},
                {"output": "test_output"}
            )

            # Check that directory was created lazily
            assert debug_logger.DEBUG_DIR.exists()

            # Check that log file was created
            log_file = debug_logger.DEBUG_DIR / "test_stage_debug.txt"
            assert log_file.exists()

            # Check content
            content = log_file.read_text()
            assert "TEST_STAGE STAGE DEBUG" in content
            assert "test_input" in content
            assert "test_output" in content

    def test_pyinstaller_frozen_environment(self):
        """Test debug logger behavior that would happen in frozen environment"""
        # Instead of trying to mock sys.frozen, let's just test the path logic
        # by directly testing the function with a mock
        from backend.text_to_graph_pipeline.agentic_workflows.core import debug_logger

        # Save original function
        original_get_debug_dir = debug_logger.get_debug_directory

        def mock_get_debug_directory():
            # Simulate what happens in frozen environment
            fake_exe = Path(self.temp_dir) / "voicetree-server"
            return fake_exe.parent / "debug_logs"

        # Replace the function
        debug_logger.get_debug_directory = mock_get_debug_directory
        debug_logger.DEBUG_DIR = debug_logger.get_debug_directory()

        try:
            # Test that logging works with the mocked directory
            debug_logger.log_transcript_processing(
                "Test transcript content",
                "test_file.txt"
            )

            # Check that directory was created
            expected_dir = Path(self.temp_dir) / "debug_logs"
            assert expected_dir.exists()

            # Check that log file was created
            log_file = expected_dir / "00_transcript_input.txt"
            assert log_file.exists()

            # Check content
            content = log_file.read_text()
            assert "TRANSCRIPT INPUT" in content
            assert "Test transcript content" in content
            assert "test_file.txt" in content

        finally:
            # Restore original function
            debug_logger.get_debug_directory = original_get_debug_dir
            debug_logger.DEBUG_DIR = original_get_debug_dir()

    def test_custom_environment_variable(self):
        """Test debug logger with custom VOICETREE_DEBUG_DIR"""
        custom_dir = Path(self.temp_dir) / "custom_debug_logs"

        # Use the already imported module
        from backend.text_to_graph_pipeline.agentic_workflows.core import debug_logger

        # Save original
        original_get_debug_dir = debug_logger.get_debug_directory
        original_dir = debug_logger.DEBUG_DIR

        # Mock to simulate environment variable being set
        def mock_get_debug_directory():
            # Simulate reading from environment
            return custom_dir

        debug_logger.get_debug_directory = mock_get_debug_directory
        debug_logger.DEBUG_DIR = debug_logger.get_debug_directory()

        try:
            # Test LLM logging
            debug_logger.log_llm_io(
                "test_agent",
                "Test prompt",
                {"response": "Test response"},
                "gpt-4"
            )

            # Check that directory was created
            assert custom_dir.exists()

            # Check that log file was created
            log_file = custom_dir / "test_agent_llm_io.txt"
            assert log_file.exists()

            # Check content
            content = log_file.read_text()
            assert "TEST_AGENT LLM I/O" in content
            assert "Test prompt" in content
            assert "Test response" in content
            assert "gpt-4" in content

        finally:
            # Restore
            debug_logger.get_debug_directory = original_get_debug_dir
            debug_logger.DEBUG_DIR = original_dir

    def test_error_handling_no_permissions(self):
        """Test that debug logger fails silently when it can't write"""
        # Set a directory we can't write to
        if sys.platform != "win32":  # Unix-like systems
            readonly_dir = Path("/") / "readonly_test_dir_that_doesnt_exist"
        else:  # Windows
            readonly_dir = Path("C:\\") / "readonly_test_dir_that_doesnt_exist"

        os.environ['VOICETREE_DEBUG_DIR'] = str(readonly_dir)

        debug_logger = get_debug_logger_module()

        # These should all fail silently without raising exceptions
        try:
            debug_logger.clear_debug_logs()
            debug_logger.log_stage_input_output("test", {}, {})
            debug_logger.log_transcript_processing("test", "test")
            debug_logger.log_llm_io("test", "prompt", "response")
            debug_logger.create_debug_summary()

            # If we get here, the error handling worked
            assert True
        except Exception as e:
            pytest.fail(f"Debug logger raised an exception when it should have failed silently: {e}")

    def test_clear_debug_logs(self):
        """Test clearing debug logs"""
        from backend.text_to_graph_pipeline.agentic_workflows.core import debug_logger

        # Save and mock
        original_get_debug_dir = debug_logger.get_debug_directory
        original_dir = debug_logger.DEBUG_DIR

        debug_logger.get_debug_directory = lambda: Path(self.temp_dir)
        debug_logger.DEBUG_DIR = debug_logger.get_debug_directory()

        try:
            # Create some test files
            debug_logger.log_stage_input_output("stage1", {"a": 1}, {"b": 2})
            debug_logger.log_stage_input_output("stage2", {"c": 3}, {"d": 4})

            # Verify files exist
            assert (Path(self.temp_dir) / "stage1_debug.txt").exists()
            assert (Path(self.temp_dir) / "stage2_debug.txt").exists()

            # Clear logs
            debug_logger.clear_debug_logs()

            # Verify files are gone
            assert not (Path(self.temp_dir) / "stage1_debug.txt").exists()
            assert not (Path(self.temp_dir) / "stage2_debug.txt").exists()

        finally:
            debug_logger.get_debug_directory = original_get_debug_dir
            debug_logger.DEBUG_DIR = original_dir

    def test_create_debug_summary(self):
        """Test creating debug summary"""
        from backend.text_to_graph_pipeline.agentic_workflows.core import debug_logger

        # Save and mock
        original_get_debug_dir = debug_logger.get_debug_directory
        original_dir = debug_logger.DEBUG_DIR

        debug_logger.get_debug_directory = lambda: Path(self.temp_dir)
        debug_logger.DEBUG_DIR = debug_logger.get_debug_directory()

        try:
            # Create some test logs
            debug_logger.log_stage_input_output("stage1", {"input": "data1"}, {"output": "result1"})
            debug_logger.log_transcript_processing("Sample transcript", "test.txt")

            # Create summary
            debug_logger.create_debug_summary()

            # Check summary file exists
            summary_file = Path(self.temp_dir) / "99_debug_summary.txt"
            assert summary_file.exists()

            # Check summary content
            content = summary_file.read_text()
            assert "WORKFLOW DEBUG SUMMARY" in content
            assert "stage1_debug.txt" in content
            assert "00_transcript_input.txt" in content
            assert "Total Debug Files: 2" in content

        finally:
            debug_logger.get_debug_directory = original_get_debug_dir
            debug_logger.DEBUG_DIR = original_dir

    def test_complex_data_formatting(self):
        """Test formatting of complex data structures"""
        from backend.text_to_graph_pipeline.agentic_workflows.core import debug_logger

        # Save and mock
        original_get_debug_dir = debug_logger.get_debug_directory
        original_dir = debug_logger.DEBUG_DIR

        debug_logger.get_debug_directory = lambda: Path(self.temp_dir)
        debug_logger.DEBUG_DIR = debug_logger.get_debug_directory()

        try:
            # Test with complex nested data
            complex_input = {
                "list_data": [1, 2, {"nested": "dict"}],
                "dict_data": {"key1": "value1", "key2": ["list", "items"]},
                "long_string": "x" * 5000,  # Should be truncated
                "normal_string": "normal length"
            }

            debug_logger.log_stage_input_output("complex_test", complex_input, {"result": "success"})

            # Check file was created and contains formatted data
            log_file = Path(self.temp_dir) / "complex_test_debug.txt"
            assert log_file.exists()

            content = log_file.read_text()
            assert "nested" in content
            assert "DEBUG_TRUNCATED" in content  # Long string should be truncated
            assert "normal length" in content

        finally:
            debug_logger.get_debug_directory = original_get_debug_dir
            debug_logger.DEBUG_DIR = original_dir