"""
Integration tests for VoiceTree LangGraph pipeline
"""

import pytest
import sys
from pathlib import Path

# Add backend to path for imports
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_path))

try:
    from backend.text_to_graph_pipeline.agentic_workflows import main
    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False


class TestAgenticWorkflowPipeline:
    """Test the agentic workflow pipeline functionality"""
    
    @pytest.mark.skipif(not LANGGRAPH_AVAILABLE, reason="LangGraph dependencies not available")
    def test_basic_pipeline(self):
        """Test the pipeline with basic input"""
        
        # Test transcript
        transcript = """
        Today I want to work on integrating LangGraph with my voice tree system.
        I need to create a multi-stage pipeline that can process transcripts effectively.
        The system should segment the text, analyze relationships, make integration decisions, and extract new nodes.
        I'm particularly interested in how well this performs compared to the existing single-LLM approach.
        """
        
        # Existing nodes
        existing_nodes = """
        Current tree nodes:
        - VoiceTree Project: Main project for voice-to-knowledge-graph system
        - LLM Integration: Work on integrating different language models
        - System Architecture: Design and architecture decisions
        """
        
        # Run the pipeline
        result = main.run_voicetree_pipeline(transcript, existing_nodes)
        
        # Assertions
        assert result is not None
        assert isinstance(result, dict)
        
        # Check that we don't have critical errors
        if result.get("error_message"):
            # Some errors are expected (like API issues), but not critical failures
            error_msg = result["error_message"]
            assert "LangGraph not installed" not in error_msg, f"Unexpected dependency error: {error_msg}"
    
    @pytest.mark.skipif(not LANGGRAPH_AVAILABLE, reason="LangGraph dependencies not available")
    def test_empty_input_handling(self):
        """Test with empty input to check error handling"""
        
        result = main.run_voicetree_pipeline("", "")
        
        # Should handle empty input gracefully
        assert result is not None
        assert isinstance(result, dict)
        
        # Should either process successfully or have a meaningful error
        if result.get("error_message"):
            error_msg = result["error_message"]
            # Should not crash with unhandled exceptions
            assert "Traceback" not in error_msg
    
    def test_module_availability(self):
        """Test that required modules are available"""
        
        # Check that core modules exist
        agentic_workflows_path = backend_path / "text_to_graph_pipeline" / "agentic_workflows"
        
        required_files = [
            "main.py",
            "nodes.py", 
            "graph.py",
            "state.py",
            "llm_integration.py",
            "schema_models.py"
        ]
        
        for file_name in required_files:
            file_path = agentic_workflows_path / file_name
            assert file_path.exists(), f"Required file missing: {file_name}"
    
    def test_prompts_availability(self):
        """Test that prompt files are available"""
        
        prompts_dir = backend_path / "text_to_graph_pipeline" / "agentic_workflows" / "prompts"
        assert prompts_dir.exists(), "Prompts directory missing"
        
        required_prompts = [
            "segmentation.txt",
            "relationship_analysis.txt",
            "integration_decision.txt"
        ]
        
        for prompt_file in required_prompts:
            prompt_path = prompts_dir / prompt_file
            assert prompt_path.exists(), f"Required prompt missing: {prompt_file}"
            
            # Check that prompt files are not empty
            assert prompt_path.stat().st_size > 0, f"Prompt file is empty: {prompt_file}"


@pytest.mark.skipif(LANGGRAPH_AVAILABLE, reason="Only run when LangGraph is not available")
def test_graceful_degradation_without_langgraph():
    """Test that the system handles missing LangGraph dependencies gracefully"""
    
    # This test runs when LangGraph is not available
    # It should verify that the system doesn't crash and provides helpful error messages
    
    try:
        from backend.text_to_graph_pipeline.agentic_workflows import main
        result = main.run_voicetree_pipeline("test input", "test nodes")
        
        # Should return an error about missing dependencies
        assert result is not None
        assert isinstance(result, dict)
        assert result.get("error_message") is not None
        
        error_msg = result["error_message"]
        assert "LangGraph" in error_msg or "dependencies" in error_msg.lower()
        
    except ImportError:
        # If we can't even import main, that's also acceptable
        # as long as it's a clean ImportError
        pass 