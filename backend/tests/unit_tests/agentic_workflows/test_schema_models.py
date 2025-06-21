"""
Unit tests for Pydantic schema models used in agentic workflows
"""

import pytest
from pydantic import ValidationError

from backend.text_to_graph_pipeline.agentic_workflows.schema_models import (
    ChunkModel,
    SegmentationResponse,
    RelationshipAnalysis,
    RelationshipResponse,
    IntegrationDecision,
    IntegrationResponse
)


class TestChunkModel:
    """Test the ChunkModel schema"""
    
    def test_chunk_model_valid(self):
        """Test creating a valid chunk model"""
        chunk = ChunkModel(
            name="Test Chunk",
            text="This is the chunk content",
            is_complete=True
        )
        
        assert chunk.name == "Test Chunk"
        assert chunk.text == "This is the chunk content"
        assert chunk.is_complete is True
    
    def test_chunk_model_missing_fields(self):
        """Test validation errors for missing required fields"""
        with pytest.raises(ValidationError) as exc_info:
            ChunkModel(name="Test")  # Missing text and is_complete
        
        errors = exc_info.value.errors()
        assert len(errors) == 2
        field_names = {e["loc"][0] for e in errors}
        assert "text" in field_names
        assert "is_complete" in field_names
    
    def test_chunk_model_serialization(self):
        """Test model serialization"""
        chunk = ChunkModel(
            name="Serialize Test",
            text="Content to serialize",
            is_complete=False
        )
        
        # Test dict conversion
        chunk_dict = chunk.model_dump()
        assert chunk_dict == {
            "name": "Serialize Test",
            "text": "Content to serialize",
            "is_complete": False
        }
        
        # Test JSON serialization
        chunk_json = chunk.model_dump_json()
        # Pydantic doesn't add spaces by default
        assert '"name":"Serialize Test"' in chunk_json
        assert '"is_complete":false' in chunk_json


class TestSegmentationResponse:
    """Test the SegmentationResponse schema"""
    
    def test_segmentation_response_valid(self):
        """Test creating a valid segmentation response"""
        response = SegmentationResponse(
            chunks=[
                ChunkModel(name="Chunk 1", text="First chunk", is_complete=True),
                ChunkModel(name="Chunk 2", text="Second chunk", is_complete=False)
            ]
        )
        
        assert len(response.chunks) == 2
        assert response.chunks[0].name == "Chunk 1"
        assert response.chunks[1].is_complete is False
    
    def test_segmentation_response_empty_chunks(self):
        """Test segmentation response with empty chunks list"""
        response = SegmentationResponse(chunks=[])
        assert response.chunks == []
    
    def test_segmentation_response_from_dict(self):
        """Test creating response from dictionary"""
        data = {
            "chunks": [
                {"name": "From Dict", "text": "Dict content", "is_complete": True}
            ]
        }
        
        response = SegmentationResponse(**data)
        assert len(response.chunks) == 1
        assert response.chunks[0].name == "From Dict"


class TestRelationshipAnalysis:
    """Test the RelationshipAnalysis schema"""
    
    def test_relationship_analysis_valid(self):
        """Test creating a valid relationship analysis"""
        analysis = RelationshipAnalysis(
            name="Test Chunk",
            text="Chunk content",
            reasoning="This chunk relates to Node1 because...",
            relevant_node_name="Node1",
            relationship="extends concept"
        )
        
        assert analysis.name == "Test Chunk"
        assert analysis.relevant_node_name == "Node1"
        assert analysis.relationship == "extends concept"
    
    def test_relationship_analysis_no_relevant_node(self):
        """Test analysis with no relevant node"""
        analysis = RelationshipAnalysis(
            name="Independent Chunk",
            text="New concept",
            reasoning="No existing nodes match this concept",
            relevant_node_name="NO_RELEVANT_NODE",
            relationship=None
        )
        
        assert analysis.relevant_node_name == "NO_RELEVANT_NODE"
        assert analysis.relationship is None
    
    def test_relationship_analysis_validation(self):
        """Test validation of required fields"""
        with pytest.raises(ValidationError) as exc_info:
            RelationshipAnalysis(
                name="Test",
                text="Content"
                # Missing reasoning and relevant_node_name
            )
        
        errors = exc_info.value.errors()
        # relationship field is Optional, so only 2 required fields missing
        assert len(errors) >= 2
        required_fields = {'reasoning', 'relevant_node_name'}
        missing_fields = {e['loc'][0] for e in errors}
        assert required_fields.issubset(missing_fields)


class TestRelationshipResponse:
    """Test the RelationshipResponse schema"""
    
    def test_relationship_response_valid(self):
        """Test creating a valid relationship response"""
        response = RelationshipResponse(
            analyzed_chunks=[
                RelationshipAnalysis(
                    name="Chunk 1",
                    text="Content 1",
                    reasoning="Reasoning 1",
                    relevant_node_name="Node1",
                    relationship="related to"
                ),
                RelationshipAnalysis(
                    name="Chunk 2",
                    text="Content 2",
                    reasoning="Reasoning 2",
                    relevant_node_name="NO_RELEVANT_NODE",
                    relationship=None
                )
            ]
        )
        
        assert len(response.analyzed_chunks) == 2
        assert response.analyzed_chunks[0].relevant_node_name == "Node1"
        assert response.analyzed_chunks[1].relationship is None


class TestIntegrationDecision:
    """Test the IntegrationDecision schema"""
    
    def test_integration_decision_create_action(self):
        """Test integration decision with CREATE action"""
        decision = IntegrationDecision(
            name="New Concept",
            text="This is a new concept about...",
            action="CREATE",
            target_node=None,
            new_node_name="New Concept Node",
            new_node_summary="A node about new concepts",
            relationship_for_edge="introduces",
            content="Full content for the new node"
        )
        
        assert decision.action == "CREATE"
        assert decision.new_node_name == "New Concept Node"
        assert decision.target_node is None
    
    def test_integration_decision_append_action(self):
        """Test integration decision with APPEND action"""
        decision = IntegrationDecision(
            name="Addition",
            text="Additional information",
            action="APPEND",
            target_node="ExistingNode",
            new_node_name=None,
            new_node_summary=None,
            relationship_for_edge=None,
            content="Content to append"
        )
        
        assert decision.action == "APPEND"
        assert decision.target_node == "ExistingNode"
        assert decision.new_node_name is None
    
    def test_integration_decision_action_validation(self):
        """Test that action must be CREATE or APPEND"""
        with pytest.raises(ValidationError) as exc_info:
            IntegrationDecision(
                name="Test",
                text="Test",
                action="INVALID",  # Invalid action
                target_node="Node",
                new_node_name=None,
                new_node_summary=None,
                relationship_for_edge=None,
                content="Content"
            )
        
        error = exc_info.value.errors()[0]
        assert "INVALID" in str(error)
    
    def test_integration_decision_serialization(self):
        """Test model serialization with optional fields"""
        decision = IntegrationDecision(
            name="Test",
            text="Test text",
            action="CREATE",
            target_node=None,
            new_node_name="New Node",
            new_node_summary=None,
            relationship_for_edge="creates",
            content="Node content"
        )
        
        decision_dict = decision.model_dump()
        assert decision_dict["action"] == "CREATE"
        assert decision_dict["target_node"] is None
        assert decision_dict["new_node_summary"] is None


class TestIntegrationResponse:
    """Test the IntegrationResponse schema"""
    
    def test_integration_response_mixed_actions(self):
        """Test response with both CREATE and APPEND decisions"""
        response = IntegrationResponse(
            integration_decisions=[
                IntegrationDecision(
                    name="New",
                    text="New content",
                    action="CREATE",
                    target_node=None,
                    new_node_name="New Node",
                    new_node_summary="Summary",
                    relationship_for_edge="creates",
                    content="Content"
                ),
                IntegrationDecision(
                    name="Update",
                    text="Update content",
                    action="APPEND",
                    target_node="Existing",
                    new_node_name=None,
                    new_node_summary=None,
                    relationship_for_edge=None,
                    content="Append content"
                )
            ]
        )
        
        assert len(response.integration_decisions) == 2
        assert response.integration_decisions[0].action == "CREATE"
        assert response.integration_decisions[1].action == "APPEND"
    
    def test_integration_response_json_serialization(self):
        """Test full response JSON serialization"""
        response = IntegrationResponse(
            integration_decisions=[
                IntegrationDecision(
                    name="Test",
                    text="Test text",
                    action="CREATE",
                    target_node=None,
                    new_node_name="Test Node",
                    new_node_summary="Test summary",
                    relationship_for_edge="test_edge",
                    content="Test content"
                )
            ]
        )
        
        json_str = response.model_dump_json(indent=2)
        assert '"integration_decisions"' in json_str
        assert '"action": "CREATE"' in json_str
        assert '"new_node_name": "Test Node"' in json_str


if __name__ == "__main__":
    pytest.main([__file__, "-v"])