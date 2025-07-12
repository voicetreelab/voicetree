# """
# Integration tests for VoiceTree LangGraph pipeline
# """

# import pytest
# import sys
# from pathlib import Path

# # Add backend to path for imports
# backend_path = Path(__file__).parent.parent.parent.parent
# sys.path.insert(0, str(backend_path))

# from backend.text_to_graph_pipeline.agentic_workflows.pipeline import run_voicetree_pipeline


# class TestAgenticWorkflowPipeline:
#     """Test the agentic workflow pipeline functionality"""
    
#     def test_basic_pipeline(self):
#         """Test the pipeline with basic input"""
        
#         # Test transcript
#         transcript = """
#         Today I want to work on integrating LangGraph with my voice tree system.
#         I need to create a multi-stage pipeline that can process transcripts effectively.
#         The system should segment the text, analyze relationships, make integration decisions, and extract new nodes.
#         I'm particularly interested in how well this performs compared to the existing single-LLM approach.
#         """
        
#         # Existing nodes
#         existing_nodes = """
#         Current tree nodes:
#         - VoiceTree Project: Main project for voice-to-knowledge-graph system
#         - LLM Integration: Work on integrating different language models
#         - System Architecture: Design and architecture decisions
#         """
        
#         # Run the pipeline
#         result = run_voicetree_pipeline(transcript, existing_nodes)
        
#         # Assertions
#         assert result is not None
#         assert isinstance(result, dict)
        
#         # Check that we don't have critical errors
#         if result.get("error_message"):
#             # Some errors are expected (like API issues), but not critical failures
#             error_msg = result["error_message"]
#             assert "LangGraph not installed" not in error_msg, f"Unexpected dependency error: {error_msg}"
    
#     def test_empty_input_handling(self):
#         """Test with empty input to check error handling"""
        
#         result = run_voicetree_pipeline("", "")
        
#         # Should handle empty input gracefully
#         assert result is not None
#         assert isinstance(result, dict)
        
#         # Should either process successfully or have a meaningful error
#         if result.get("error_message"):
#             error_msg = result["error_message"]
#             # Should not crash with unhandled exceptions
#             assert "Traceback" not in error_msg
    
#     def test_module_availability(self):
#         """Test that required modules are available"""
        
#         # Check that core modules exist
#         agentic_workflows_path = backend_path / "text_to_graph_pipeline" / "agentic_workflows"
        
#         required_files = [
#             "pipeline.py",
#             "nodes.py", 
#             "graph.py",
#             "state.py",
#             "llm_integration.py",
#             "schema_models.py"
#         ]
        
#         for file_name in required_files:
#             file_path = agentic_workflows_path / file_name
#             assert file_path.exists(), f"Required file missing: {file_name}"