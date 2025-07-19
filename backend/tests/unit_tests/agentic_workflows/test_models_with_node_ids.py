"""
Unit tests for updated models with node ID support
"""

import pytest
from pydantic import ValidationError
from typing import Optional
from backend.text_to_graph_pipeline.agentic_workflows.models import (
    TargetNodeIdentification,
    TargetNodeResponse
)


class TestTargetNodeIdentificationWithIDs:
    """Test the updated TargetNodeIdentification model with node IDs"""
    
    def test_existing_node_with_id(self):
        """Test creating a target node identification for an existing node"""
        target = TargetNodeIdentification(
            text="Add caching to improve performance",
            reasoning="This relates to performance optimization",
            target_node_id=5,
            target_node_name="Performance Optimization",
            is_new_node=False
        )
        
        assert target.target_node_id == 5
        assert target.target_node_name == "Performance Optimization"
        assert target.is_new_node == False
        assert target.new_node_name is None  # Should be None for existing nodes
    
    def test_new_node_with_special_id(self):
        """Test creating a target node identification for a new node"""
        target = TargetNodeIdentification(
            text="Implement user authentication",
            reasoning="This is a new security feature not covered by existing nodes",
            target_node_id=-1,  # Special ID for new nodes
            is_new_node=True,
            new_node_name="User Authentication"
        )
        
        assert target.target_node_id == -1
        assert target.is_new_node == True
        assert target.new_node_name == "User Authentication"
    
    def test_validation_new_node_requires_name(self):
        """Test that new nodes require a name"""
        with pytest.raises(ValidationError) as exc_info:
            TargetNodeIdentification(
                text="Some text",
                reasoning="Some reasoning",
                target_node_id=-1,
                is_new_node=True
                # Missing new_node_name
            )
        
        # The validation error should mention the missing new_node_name
        assert "new_node_name" in str(exc_info.value)
    
    def test_validation_existing_node_positive_id(self):
        """Test that existing nodes should have non-negative IDs"""
        # This should work - existing node with positive ID
        target = TargetNodeIdentification(
            text="Some text",
            reasoning="Some reasoning",
            target_node_id=1,
            target_node_name="Existing Node",
            is_new_node=False
        )
        assert target.target_node_id == 1
        
        # This should also work - existing node with ID 0 (root node)
        target_root = TargetNodeIdentification(
            text="Some text for root",
            reasoning="Some reasoning for root",
            target_node_id=0,
            target_node_name="Root Node",
            is_new_node=False
        )
        assert target_root.target_node_id == 0
        
        # This should fail - existing node with -1 ID
        with pytest.raises(ValidationError) as exc_info:
            TargetNodeIdentification(
                text="Some text",
                reasoning="Some reasoning",
                target_node_id=-1,
                target_node_name="Some Node",
                is_new_node=False  # Says existing but ID is -1
            )
        
        assert "existing node" in str(exc_info.value).lower()
    
    def test_response_model_with_multiple_targets(self):
        """Test the response model with multiple target identifications"""
        response = TargetNodeResponse(
            target_nodes=[
                TargetNodeIdentification(
                    text="Performance improvement",
                    reasoning="Related to existing optimization work",
                    target_node_id=3,
                    target_node_name="Performance Optimization",
                    is_new_node=False
                ),
                TargetNodeIdentification(
                    text="New feature: chat interface",
                    reasoning="Completely new functionality",
                    target_node_id=-1,
                    is_new_node=True,
                    new_node_name="Chat Interface"
                )
            ]
        )
        
        assert len(response.target_nodes) == 2
        assert response.target_nodes[0].target_node_id == 3
        assert response.target_nodes[1].target_node_id == -1
        assert response.target_nodes[1].new_node_name == "Chat Interface"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])