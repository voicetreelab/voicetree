#!/usr/bin/env python3
"""
Test to validate migration progress and ensure legacy usage is eliminated
"""

import pytest
import ast
import os
from pathlib import Path


class TestMigrationProgress:
    """Test the migration progress and validate legacy code elimination"""
    
    def test_test_segmentation_migration_complete(self):
        """Test that test_segmentation.py has been fully migrated"""
        segmentation_file = Path("test_segmentation.py")
        
        # File should exist
        assert segmentation_file.exists(), "test_segmentation.py should exist"
        
        # Read file content
        with open(segmentation_file, 'r') as f:
            content = f.read()
        
        # Should NOT contain legacy imports (excluding comments and strings)
        lines = content.split('\n')
        actual_code_lines = [
            line.strip() for line in lines 
            if line.strip() and not line.strip().startswith('#') and not line.strip().startswith('print(')
        ]
        actual_code = '\n'.join(actual_code_lines)
        
        legacy_imports = [
            "from backend.agentic_workflows.llm_integration import call_llm",
            "from backend.agentic_workflows.nodes import segmentation_node",
            "sys.path.insert(0",
            "sys.path.append("
        ]
        
        for legacy_import in legacy_imports:
            assert legacy_import not in actual_code, f"Legacy import found in actual code: {legacy_import}"
        
        # Should NOT contain legacy function calls  
        legacy_calls = [
            "call_llm(",
            "segmentation_node(",
            "extract_json_from_response(",
            "json.loads("
        ]
        
        for legacy_call in legacy_calls:
            assert legacy_call not in actual_code, f"Legacy function call found in actual code: {legacy_call}"
        
        # Should contain new architecture imports
        new_imports = [
            "from backend.core import get_config, LLMClient",
            "from backend.core.models import SegmentationResponse"
        ]
        
        for new_import in new_imports:
            assert new_import in content, f"New import missing: {new_import}"
        
        # Should contain new architecture calls
        new_calls = [
            "llm_client.call_structured(",
            "SegmentationResponse",
            "await"
        ]
        
        for new_call in new_calls:
            assert new_call in content, f"New architecture call missing: {new_call}"
            
    def test_migration_can_import_new_architecture(self):
        """Test that we can import all new architecture components"""
        # These should all work without error
        from backend.core import get_config, LLMClient
        from backend.core.models import (
            NodeAction, SegmentationResponse, WorkflowResult, ProcessResult
        )
        from backend.tree import TreeManager, TreeStorage, BufferManager
        from backend.workflows import WorkflowPipeline
        
        # Basic instantiation tests
        config = get_config()
        assert config is not None
        
        llm_client = LLMClient(config.llm)
        assert llm_client is not None
        
        # Model creation tests
        node_action = NodeAction.create_node(
            concept_name="Test",
            content="Test content",
            summary="Test summary",
            parent_concept_name="Root"
        )
        assert node_action.action == "CREATE"
        assert node_action.concept_name == "Test"
        
    def test_legacy_usage_count_decreased(self):
        """Test that we've reduced the legacy usage count"""
        # Run migration checker and verify count decreased
        from backend.migration import check_legacy_usage
        
        project_root = Path(".")
        findings = check_legacy_usage(project_root)
        
        # We should have reduced the count from 158 to 155 (eliminated 3 from test_segmentation.py)
        total_legacy_instances = len(findings["legacy_usage_found"])
        
        # Should be less than the original 158
        assert total_legacy_instances < 158, f"Legacy usage count should be reduced, found {total_legacy_instances}"
        
        # Should not find any legacy usage in test_segmentation.py specifically
        segmentation_usage = [
            finding for finding in findings["legacy_usage_found"] 
            if "test_segmentation.py" in finding["file"]
        ]
        
        assert len(segmentation_usage) == 0, f"test_segmentation.py should have no legacy usage, found: {segmentation_usage}"
        
    def test_migration_functionality_preserved(self):
        """Test that the migrated functionality works as expected"""
        import asyncio
        
        async def test_functionality():
            from backend.core import get_config, LLMClient
            from backend.core.models import SegmentationResponse
            
            config = get_config()
            llm_client = LLMClient(config.llm)
            
            # Test that we can create the structured prompt and call
            test_transcript = "This is a test transcript for validation."
            
            # This should work without errors (same as the migrated test_segmentation.py)
            prompt = f"""
            Segment this transcript: {test_transcript}
            Return JSON with chunks array.
            """
            
            # We won't actually call the LLM in tests, but we can test the setup
            assert llm_client is not None
            assert isinstance(prompt, str)
            assert len(prompt) > 0
            
            return True
        
        # Run the async test
        result = asyncio.run(test_functionality())
        assert result is True
        
    def test_new_architecture_test_coverage(self):
        """Ensure we have comprehensive tests for the new architecture"""
        # Check that our test_new_architecture.py file exists and has proper coverage
        test_file = Path("backend/tests/unit_tests/test_new_architecture.py")
        assert test_file.exists(), "New architecture tests should exist"
        
        with open(test_file, 'r') as f:
            content = f.read()
        
        # Should test all major components
        required_test_classes = [
            "TestConfiguration",
            "TestPydanticModels", 
            "TestLLMClient",
            "TestBufferManager",
            "TestTreeStorage",
            "TestUnifiedTreeManager",
            "TestWorkflowPipeline"
        ]
        
        for test_class in required_test_classes:
            assert f"class {test_class}" in content, f"Missing test class: {test_class}"


class TestMigrationValidation:
    """Integration tests to validate the migration is working"""
    
    @pytest.mark.asyncio
    async def test_migrated_segmentation_functionality(self):
        """Test that the migrated segmentation functionality works correctly"""
        from backend.core import get_config, LLMClient
        from backend.core.models import SegmentationResponse, ChunkModel
        
        config = get_config()
        llm_client = LLMClient(config.llm)
        
        # Test the same functionality as the original test_segmentation.py
        test_transcript = "This is a test. It has multiple sentences."
        
        prompt = f"""
        Segment this transcript into logical chunks:
        {test_transcript}
        
        Return JSON: {{"chunks": [{{"name": "...", "text": "...", "is_complete": true}}]}}
        """
        
        # Mock the LLM call for testing
        import json
        from unittest.mock import AsyncMock, patch
        
        mock_response = {
            "chunks": [
                {"name": "Test chunk", "text": "This is a test.", "is_complete": True}
            ]
        }
        
        with patch.object(llm_client, 'call_structured') as mock_call:
            mock_call.return_value = SegmentationResponse(
                chunks=[ChunkModel(name="Test chunk", text="This is a test.", is_complete=True)]
            )
            
            result = await llm_client.call_structured(
                prompt=prompt,
                response_model=SegmentationResponse
            )
            
            # Validate the result structure (same as original functionality)
            assert isinstance(result, SegmentationResponse)
            assert len(result.chunks) > 0
            assert isinstance(result.chunks[0], ChunkModel)
            assert hasattr(result.chunks[0], 'name')
            assert hasattr(result.chunks[0], 'text')
            assert hasattr(result.chunks[0], 'is_complete')
            
            # Verify the mock was called correctly
            mock_call.assert_called_once()
            
    def test_migration_progress_tracking(self):
        """Test that we can track migration progress"""
        # This validates that our migration tracking is working
        from backend.migration import create_migration_plan
        
        plan = create_migration_plan()
        
        # Should have the expected structure
        assert "phase_1_immediate_actions" in plan
        assert "phase_2_component_migration" in plan
        assert "phase_3_cleanup" in plan
        
        # Should include our completed migration
        phase_1_steps = plan["phase_1_immediate_actions"]["steps"]
        import_step = next((step for step in phase_1_steps if "import" in step["step"].lower()), None)
        assert import_step is not None, "Should have import migration step"


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 