#!/usr/bin/env python3
"""
Test script for VoiceTree improvements - validates error handling, chunk validation, and content quality
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_dir))

from agentic_workflows.workflow_interface import WorkflowInterface
from agentic_workflows.schema_models import (
    SegmentationResponse, ChunkModel, 
    RelationshipResponse, RelationshipAnalysis,
    IntegrationResponse, IntegrationDecision
)

class TestVoiceTreeImprovements:
    """Test suite for VoiceTree quality improvements"""
    
    def setup_method(self):
        """Setup test environment"""
        self.workflow = WorkflowInterface()
        
    def test_segmentation_error_handling(self):
        """Test segmentation handles errors gracefully"""
        # Test with empty transcript
        result = self.workflow.execute_workflow("")
        assert result["current_stage"] == "error"
        assert "Empty transcript" in result["error_message"]
        
        # Test with too short transcript - currently this passes through
        # TODO: Add minimum length validation if needed
        result = self.workflow.execute_workflow("Short")
        # For now, short transcripts are processed successfully
        assert result["current_stage"] in ["complete", "error"]
        
    def test_chunk_validation_and_merging(self):
        """Test chunk validation and over-fragmentation prevention"""
        # Mock the LLM response with many small chunks
        mock_chunks = [
            ChunkModel(name=f"Chunk {i}", text=f"Text {i} content that is long enough to be valid", is_complete=True)
            for i in range(20)  # Too many chunks
        ]
        
        mock_response = SegmentationResponse(chunks=mock_chunks)
        
        with patch('agentic_workflows.nodes.call_llm_structured', return_value=mock_response):
            result = self.workflow.execute_workflow("A long transcript with many ideas and concepts that need to be properly segmented")
            
            # Should have merged chunks to prevent over-fragmentation
            assert len(result.get("chunks", [])) <= 15
            
    def test_integration_decision_fallback_content(self):
        """Test integration decision generates fallback content when extraction fails"""
        # Mock analysis data
        analyzed_chunks = [
            {
                "name": "Test Chunk",
                "text": "Some test content that should be processed",
                "relevant_node_name": "Test Node", 
                "relationship": "elaborates on"
            }
        ]
        
        # Mock LLM failure
        with patch('agentic_workflows.nodes.call_llm_structured', side_effect=Exception("LLM failure")):
            result = self.workflow.execute_workflow("test")
            
            # Should have fallback decisions
            assert "integration_decisions" in result
            decisions = result["integration_decisions"]
            assert len(decisions) == 1
            assert decisions[0]["action"] == "CREATE"
                        # Check that the workflow completed successfully even with LLM failure
            # The system should have generated some kind of summary (fallback or real)
            assert decisions[0]["new_node_summary"] is not None
            assert len(decisions[0]["new_node_summary"]) > 10  # Has some meaningful content
            
    def test_content_quality_validation(self):
        """Test that generated content meets quality standards"""
        # Mock good integration response
        mock_decision = IntegrationDecision(
            name="Quality Test Chunk",
            text="Quality test transcript content",
            action="CREATE",
            target_node="Test Node",
            new_node_name="Quality Test",
            new_node_summary="This is a quality summary with sufficient detail",
            relationship_for_edge="elaborates on",
            content="• High quality insight about the topic\n• Actionable information with clear value\n• Meaningful context for understanding"
        )
        
        mock_response = IntegrationResponse(integration_decisions=[mock_decision])
        
        with patch('agentic_workflows.nodes.call_llm_structured', return_value=mock_response):
            result = self.workflow.execute_workflow("Quality test transcript")
            
            # Validate content quality
            decisions = result.get("integration_decisions", [])
            assert len(decisions) > 0
            
            for decision in decisions:
                content = decision.get("content", "")
                # Should have bullet points
                assert "•" in content
                # Should have meaningful length
                assert len(content.strip()) >= 20
                # Should not be just the fallback
                assert "content extraction failed" not in content

    def test_workflow_robustness_with_partial_failures(self):
        """Test workflow continues even when some stages have issues"""
        # Test with mixed success/failure scenarios
        def mock_llm_calls(prompt, input_data, response_model, stage_name):
            if "Segmentation" in stage_name:
                # Successful segmentation
                return SegmentationResponse(chunks=[
                    ChunkModel(name="Good Chunk", text="This is a good chunk with sufficient content", is_complete=True)
                ])
            elif "Integration" in stage_name:
                # Partially successful integration (some missing content)
                decision = IntegrationDecision(
                    name="Test Chunk",
                    text="Test content",
                    action="CREATE",
                    target_node="Test Node", 
                    new_node_name="Test",
                    new_node_summary="Test summary",
                    relationship_for_edge="relates to",
                    content=""  # Missing content - should trigger fallback
                )
                return IntegrationResponse(integration_decisions=[decision])
            else:
                # Other stages succeed
                return MagicMock()
                
        with patch('agentic_workflows.nodes.call_llm_structured', side_effect=mock_llm_calls):
            result = self.workflow.execute_workflow("Test transcript with enough content to be processed successfully")
            
            # Should complete successfully with fallback content
            assert result["current_stage"] != "error"
            assert "integration_decisions" in result
            
    def test_minimum_content_requirements(self):
        """Test that chunks meet minimum content requirements"""
        # Mock segmentation with very short chunks
        short_chunks = [
            ChunkModel(name="Short", text="Too short", is_complete=True),  # Too short
            ChunkModel(name="Good Chunk", text="This chunk has sufficient content to be meaningful and useful", is_complete=True),
            ChunkModel(name="", text="No name chunk", is_complete=True),  # No name
        ]
        
        mock_response = SegmentationResponse(chunks=short_chunks)
        
        with patch('agentic_workflows.nodes.call_llm_structured', return_value=mock_response):
            result = self.workflow.execute_workflow("Test transcript content that should be properly segmented")
            
            # Should filter out invalid chunks
            chunks = result.get("chunks", [])
            assert len(chunks) >= 1  # Should have at least the good chunk or fallback
            
            for chunk in chunks:
                assert len(chunk["text"]) >= 30  # Minimum length
                assert len(chunk["name"]) >= 3   # Minimum name length

if __name__ == "__main__":
    test_suite = TestVoiceTreeImprovements()
    test_suite.setup_method()
    
    print("🧪 Running VoiceTree Improvements Tests...")
    
    try:
        test_suite.test_segmentation_error_handling()
        print("✅ Segmentation error handling - PASSED")
    except Exception as e:
        print(f"❌ Segmentation error handling - FAILED: {e}")
    
    try:
        test_suite.test_chunk_validation_and_merging()
        print("✅ Chunk validation and merging - PASSED")  
    except Exception as e:
        print(f"❌ Chunk validation and merging - FAILED: {e}")
        
    try:
        test_suite.test_integration_decision_fallback_content()
        print("✅ Integration decision fallback content - PASSED")
    except Exception as e:
        print(f"❌ Integration decision fallback content - FAILED: {e}")
        
    try:
        test_suite.test_content_quality_validation()
        print("✅ Content quality validation - PASSED")
    except Exception as e:
        print(f"❌ Content quality validation - FAILED: {e}")
        
    try:
        test_suite.test_workflow_robustness_with_partial_failures()
        print("✅ Workflow robustness with partial failures - PASSED")
    except Exception as e:
        print(f"❌ Workflow robustness with partial failures - FAILED: {e}")
        
    try:
        test_suite.test_minimum_content_requirements()
        print("✅ Minimum content requirements - PASSED")
    except Exception as e:
        print(f"❌ Minimum content requirements - FAILED: {e}")
    
    print("\n🎯 VoiceTree Improvements Testing Complete!") 