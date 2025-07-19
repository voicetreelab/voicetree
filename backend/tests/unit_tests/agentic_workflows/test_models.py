"""
Unit tests for Pydantic schema models used in agentic workflows
"""

import pytest
from pydantic import ValidationError

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    RelationshipAnalysis, RelationshipResponse, SegmentationResponse,
    SegmentModel)


class TestChunkModel:
    """Test the ChunkModel schema"""
    
    def test_chunk_model_valid(self):
        """Test creating a valid chunk model"""
        chunk = SegmentModel(
            text="This is the chunk content",
            is_complete=True,
            reasoning="This chunk is complete and ready for processing"
        )
        
        assert chunk.text == "This is the chunk content"
        assert chunk.is_complete is True
        assert chunk.reasoning == "This chunk is complete and ready for processing"
    
    def test_chunk_model_missing_fields(self):
        """Test validation errors for missing required fields"""
        with pytest.raises(ValidationError) as exc_info:
            SegmentModel(text="Test")  # Missing is_complete and reasoning
        
        errors = exc_info.value.errors()
        assert len(errors) >= 2
        field_names = {e["loc"][0] for e in errors}
        assert "is_complete" in field_names
        assert "reasoning" in field_names


class TestSegmentationResponse:
    """Test the SegmentationResponse schema"""
    
    
    def test_segmentation_response_empty_chunks(self):
        """Test segmentation response with empty chunks list"""
        response = SegmentationResponse(segments=[])
        assert response.segments == []
    
    def test_segmentation_response_from_dict(self):
        """Test creating response from dictionary"""
        data = {
            "chunks": [
                {"text": "Dict content", "reasoning" : ",,," ,"is_complete": True}
            ]
        }
        
        response = SegmentationResponse(**data)
        assert len(response.segments) == 1
        assert response.segments[0].text == "Dict content"
        assert response.segments[0].is_complete is True


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





if __name__ == "__main__":
    pytest.main([__file__, "-v"])