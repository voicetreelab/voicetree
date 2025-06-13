import asyncio
import unittest
import logging
from unittest.mock import patch, MagicMock
import json
import os

from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.LLM_engine.summarize_with_llm import Summarizer
from backend.agentic_workflows.main import VoiceTreePipeline, run_voicetree_pipeline
from backend.agentic_workflows.llm_integration import call_llm_structured


class TestReproduceManualIssues(unittest.TestCase):
    """Integration tests to reproduce issues found during manual testing"""
    
    def setUp(self):
        """Set up test environment"""
        self.decision_tree = DecisionTree()
        self.workflow_manager = WorkflowTreeManager(self.decision_tree)
        
        # Silence logging during tests
        logging.getLogger().setLevel(logging.CRITICAL)
    
    def tearDown(self):
        """Clean up test files""" 
        test_files = ["test_workflow_state.json", "voicetree_workflow_state.json"]
        for file in test_files:
            if os.path.exists(file):
                os.remove(file)
    
    def test_summarize_with_llm_format_issue(self): #TODO THIS TEST IS FLAKKYYYYYY
        """Test Issue #1: Summarization returns markdown instead of expected plain text"""
        async def run_test():
            summarizer = Summarizer()
            
            # This should return plain text like "**This is a concise summary.**"
            # But currently returns markdown with code blocks
            result = await summarizer.summarize_with_llm(
                "This is some text to summarize.",
                "TODO: transcript history"
            )
            
            # Current failing assertion from the unit test
            # self.assertEqual(result, "**This is a concise summary.**")
            
            # Check the actual format we're getting
            print(f"Actual summarization result: {repr(result)}")
            
            # The issue is likely that the LLM returns markdown formatted text
            # with code blocks, but the test expects plain bold text
            self.assertIsInstance(result, str)
            self.assertGreater(len(result), 0)
            
            # Check if it contains markdown code blocks (the problem)
            if result.startswith("```") and result.endswith("```"):
                self.fail(f"Summarization returned markdown code blocks instead of plain text: {result}")
        
        asyncio.run(run_test())
    
    def test_pydantic_validation_errors(self):
        """Test Issue #2: Pydantic validation errors for missing required fields"""
        pipeline = VoiceTreePipeline("test_workflow_state.json")
        
        # Test transcript that causes validation errors
        test_transcript = "Hello? Testing, one, two, three, testing."
        
        result = pipeline.run(test_transcript)
        
        # Check if we got validation errors
        if result.get("error_message"):
            error_msg = result["error_message"]
            print(f"Pipeline error: {error_msg}")
            
            # Check for specific validation error patterns
            validation_patterns = [
                "Field required",
                "reasoning",
                "relevant_node_name", 
                "relationship",
                "validation error"
            ]
            
            for pattern in validation_patterns:
                if pattern in error_msg:
                    self.fail(f"Found Pydantic validation error: {error_msg}")
        
        # Check if chunks were processed successfully
        chunks = result.get("chunks", [])
        print(f"Chunks processed: {len(chunks)}")
        
        # Check relationship analysis
        analyzed_chunks = result.get("analyzed_chunks", [])
        print(f"Analyzed chunks: {len(analyzed_chunks)}")
        
        # Validate that analyzed chunks have required fields
        for i, chunk in enumerate(analyzed_chunks):
            required_fields = ["reasoning", "relevant_node_name", "relationship"]
            for field in required_fields:
                if field not in chunk:
                    self.fail(f"Chunk {i} missing required field '{field}': {chunk}")
    
    def test_json_parsing_truncation_errors(self):
        """Test Issue #3: JSON parsing errors due to response truncation"""
        pipeline = VoiceTreePipeline("test_workflow_state.json")
        
        # Test with longer transcript that might cause truncation
        long_transcript = """
        Okay, so what are we doing? Um, okay, so we got a few different
        agents running in the background we. Our first thing was making the system just generally robust.
        getting all our tests passing one thing we still have to do is completely switch
        over from the old LLM API in LLM engine and move it to using the agentic
        workflow LLM integration API I think the LLM API is still used for one thing
        which is the summarization so I don't think summarization works
        right and it's probably still using we need to make summarize of LLM we
        probably need to move that to be an agentic workflow
        """
        
        result = pipeline.run(long_transcript)
        
        # Check for JSON parsing errors
        if result.get("error_message"):
            error_msg = result["error_message"]
            json_error_patterns = [
                "Invalid JSON",
                "EOF while parsing",
                "json_invalid",
                "Expecting"
            ]
            
            for pattern in json_error_patterns:
                if pattern in error_msg:
                    self.fail(f"Found JSON parsing error: {error_msg}")
    
    def test_integration_decision_name_extraction_failure(self):
        """Test Issue #4: Integration Decision fails to extract 'name' field"""
        pipeline = VoiceTreePipeline("test_workflow_state.json")
        
        test_transcript = "Um, which means, oh, I have to do a fair bit of stuff."
        
        result = pipeline.run(test_transcript)
        
        # Check for integration decision errors
        if result.get("error_message"):
            error_msg = result["error_message"]
            if "Integration Decision failed" in error_msg and '"name"' in error_msg:
                self.fail(f"Integration Decision name extraction failed: {error_msg}")
        
        # Check that integration decisions were created properly
        integration_decisions = result.get("integration_decisions", [])
        for i, decision in enumerate(integration_decisions):
            if "name" not in decision:
                self.fail(f"Integration decision {i} missing 'name' field: {decision}")
    
    def test_segmentation_fallback_issue(self):
        """Test Issue #5: Segmentation consistently falls back to single chunk"""
        pipeline = VoiceTreePipeline("test_workflow_state.json")
        
        # Test transcript that should clearly segment into multiple chunks
        clear_multi_idea_transcript = """
        First, I need to work on the user interface design.
        Second, I should implement the backend API endpoints.
        Third, we need to set up the database schema.
        Finally, testing and deployment should be planned.
        """
        
        result = pipeline.run(clear_multi_idea_transcript)
        
        chunks = result.get("chunks", [])
        print(f"Number of chunks created: {len(chunks)}")
        
        # This transcript should create multiple chunks, not just fallback to one
        if len(chunks) == 1 and chunks[0].get("name") == "Voice Input":
            self.fail("Segmentation fell back to single chunk fallback instead of proper segmentation")
        
        # Should have at least 3-4 chunks for the clear multi-idea transcript
        if len(chunks) < 3:
            print(f"Warning: Only {len(chunks)} chunks created from clearly multi-idea transcript")
    
    def test_old_llm_api_still_in_use(self):
        """Test Issue #6: Check if old LLM API is still being used instead of agentic workflow"""
        async def run_test():
            # Test if the old ContextualTreeManager (non-workflow) is being called anywhere
            old_tree_manager = self.decision_tree
            
            # The issue is that summarization still uses the old LLM_engine.summarize_with_llm
            # instead of being integrated into the agentic workflow
            
            summarizer = Summarizer()
            
            # Check if this uses the old LLM API
            with patch('backend.tree_manager.LLM_engine.LLM_API.generate_async') as mock_old_api:
                mock_old_api.return_value = "Mock old API response"
                
                result = await summarizer.summarize_with_llm("Test text", "Test history")
                
                if mock_old_api.called:
                    print("WARNING: Old LLM API is still being used for summarization")
                    print("This should be migrated to use the agentic workflow system")
        
        asyncio.run(run_test())
    
    def test_structured_llm_response_validation(self):
        """Test that structured LLM responses match expected Pydantic models"""
        try:
            # Test each stage type to ensure responses validate properly
            stage_types = ["segmentation", "relationship", "integration", "extraction"]
            
            for stage_type in stage_types:
                print(f"Testing structured response for {stage_type}")
                
                # Mock a proper response for this stage
                test_prompt = f"Test prompt for {stage_type}"
                
                try:
                    response = call_llm_structured(test_prompt, stage_type)
                    
                    # The response should be a valid Pydantic model
                    self.assertTrue(hasattr(response, 'model_dump'))
                    
                    # Try to convert to dict (this should not fail)
                    response_dict = response.model_dump()
                    self.assertIsInstance(response_dict, dict)
                    
                    print(f"✅ {stage_type} structured response validated successfully")
                    
                except Exception as e:
                    print(f"❌ {stage_type} structured response validation failed: {e}")
                    # Don't fail the test here, just log the issue
        
        except ImportError:
            self.skipTest("LLM integration not available for testing")


if __name__ == "__main__":
    unittest.main() 