"""
Unit test for identify_target_node prompt loading and basic functionality
This test validates that the prompt changes from the recent commit work correctly
without requiring actual LLM API calls.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, AsyncMock, patch

from backend.text_to_graph_pipeline.agentic_workflows.core.prompt_engine import PromptLoader
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    TargetNodeIdentification, TargetNodeResponse
)


class TestIdentifyTargetNodePrompt:
    """Test the identify_target_node prompt after recent changes"""
    
    @pytest.fixture 
    def prompt_loader(self):
        """Get prompt loader instance"""
        # Get the absolute path to prompts directory
        backend_dir = Path(__file__).parent.parent.parent.parent.parent
        prompts_dir = backend_dir / "backend" / "text_to_graph_pipeline" / "agentic_workflows" / "prompts"
        return PromptLoader(str(prompts_dir.absolute()))

    def test_prompt_loads_successfully(self, prompt_loader):
        """Test that the identify_target_node prompt loads without errors"""
        # This tests that the recent git changes didn't break the prompt file structure
        template = prompt_loader.load_template("identify_target_node")
        assert template is not None
        
    def test_prompt_renders_with_variables(self, prompt_loader):
        """Test that the prompt renders correctly with template variables"""
        # Test data similar to what the integration tests use
        existing_nodes = """
        [
            {"id": 1, "name": "Test Node", "summary": "A test node"}
        ]
        """
        
        segments = """
        [
            {"text": "This is a test segment", "is_routable": true}
        ]
        """
        
        # Render the template
        rendered_prompt = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes=existing_nodes,
            segments=segments,
            transcript_history="Test history",
            transcript_text="This is a test segment"
        )
        
        # Verify that template variables were substituted
        assert "{{" not in rendered_prompt  # No unsubstituted template variables
        assert "This is a test segment" in rendered_prompt
        assert "Test Node" in rendered_prompt
        assert "transcript_history" not in rendered_prompt  # Template var should be gone
        
        # Verify key prompt instructions are present (from recent changes)
        assert "Global understanding" in rendered_prompt
        assert "Correctness" in rendered_prompt
        assert "Significance" in rendered_prompt
        
    def test_prompt_contains_expected_instructions(self, prompt_loader):
        """Test that recent prompt changes are reflected in the loaded template"""
        template = prompt_loader.load_template("identify_target_node")
        prompt_content = template.template
        
        # Verify key changes from the git diff are present
        assert "create a new concept node" in prompt_content
        assert "glboal_understanding" in prompt_content  # Note: this typo still exists in the prompt
        assert "semantic*, and *pragmatic* meaning" in prompt_content
        assert "Anti-Orphan Chain Rule" in prompt_content
        
    def test_prompt_structure_is_valid(self, prompt_loader):
        """Test that the prompt has the expected structural elements"""
        template = prompt_loader.load_template("identify_target_node")
        prompt_content = template.template
        
        # Check for required sections
        assert "CONTEXT HIERARCHY" in prompt_content
        assert "Global understanding" in prompt_content
        assert "Correctness" in prompt_content
        assert "Significance" in prompt_content
        assert "Handling orphans" in prompt_content
        assert "EXAMPLE" in prompt_content
        assert "INPUT DATA" in prompt_content
        
        # Check for template variables
        assert "{{transcript_history}}" in prompt_content
        assert "{{existing_nodes}}" in prompt_content
        assert "{{transcript_text}}" in prompt_content
        assert "{{segments}}" in prompt_content

    @pytest.mark.asyncio
    async def test_mock_llm_integration(self, prompt_loader):
        """Test that the prompt would work with mocked LLM response"""
        # Mock LLM response matching the expected schema
        mock_response = TargetNodeResponse(
            target_nodes=[
                TargetNodeIdentification(
                    text="Test segment text",
                    reasoning="Test reasoning for routing decision",
                    target_node_id=1,
                    target_node_name="Test Node",
                    is_orphan=False,
                    orphan_topic_name=None,
                    relationship_to_target="is related to"
                )
            ],
            global_reasoning="Global understanding of the text",
            debug_notes=None
        )
        
        # Test that the mock response matches expected schema
        assert len(mock_response.target_nodes) == 1
        assert mock_response.target_nodes[0].target_node_id == 1
        assert mock_response.target_nodes[0].is_orphan is False
        assert mock_response.target_nodes[0].target_node_name == "Test Node"
        
        # Render the prompt to ensure it would work
        rendered_prompt = prompt_loader.render_template(
            "identify_target_node",
            existing_nodes='[{"id": 1, "name": "Test Node", "summary": "A test node"}]',
            segments='[{"text": "Test segment text", "is_routable": true}]',
            transcript_history="",
            transcript_text="Test segment text"
        )
        
        # Verify the prompt renders without errors
        assert len(rendered_prompt) > 1000  # Reasonable length check
        assert "Test segment text" in rendered_prompt


if __name__ == "__main__":
    pytest.main([__file__, "-v"])