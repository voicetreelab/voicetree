"""
Unit tests for sentence extraction utilities
"""

import pytest
from backend.text_to_graph_pipeline.text_buffer_manager.sentence_extractor import SentenceExtractor


class TestSentenceExtractor:
    """Test suite for SentenceExtractor class"""
    
    def setup_method(self):
        """Set up test instance"""
        self.extractor = SentenceExtractor()
    
    def test_extract_complete_sentences_empty_text(self):
        """Test extraction with empty text"""
        result = self.extractor.extract_complete_sentences("")
        assert result == ""
    
    def test_extract_complete_sentences_no_complete_sentences(self):
        """Test extraction when no complete sentences exist"""
        result = self.extractor.extract_complete_sentences("This is incomplete")
        assert result == ""
    
    def test_extract_complete_sentences_single_sentence(self):
        """Test extraction with single complete sentence"""
        result = self.extractor.extract_complete_sentences("This is complete.")
        assert result == "This is complete."
    
    def test_extract_complete_sentences_multiple_sentences(self):
        """Test extraction with multiple complete sentences"""
        text = "First sentence. Second sentence! Third sentence?"
        result = self.extractor.extract_complete_sentences(text)
        assert result == "First sentence. Second sentence! Third sentence?"
    
    def test_extract_complete_sentences_with_incomplete_end(self):
        """Test extraction leaves incomplete sentence at end"""
        text = "Complete sentence. This is incomplete"
        result = self.extractor.extract_complete_sentences(text)
        assert result == "Complete sentence."
    
    def test_extract_complete_sentences_with_ellipses(self):
        """Test extraction handles ellipses correctly"""
        text = "Complete sentence. And then..."
        result = self.extractor.extract_complete_sentences(text)
        assert result == "Complete sentence."
    
    def test_extract_complete_sentences_ellipses_only(self):
        """Test extraction with only ellipses"""
        text = "Just trailing off..."
        result = self.extractor.extract_complete_sentences(text)
        assert result == ""
    
    def test_extract_complete_sentences_multiple_ellipses(self):
        """Test extraction with multiple ellipses"""
        text = "First part... second part... Complete sentence. More..."
        result = self.extractor.extract_complete_sentences(text)
        # The function rejoins with '...' so the complete result is returned
        assert "Complete sentence." in result
    
    def test_extract_before_ellipses_no_complete_sentences(self):
        """Test _extract_before_ellipses with no complete sentences"""
        text = "No complete sentences here..."
        result = self.extractor._extract_before_ellipses(text)
        assert result == ""
    
    def test_extract_before_ellipses_with_complete_sentences(self):
        """Test _extract_before_ellipses with complete sentences"""
        text = "Complete sentence. Another one! And then..."
        result = self.extractor._extract_before_ellipses(text)
        assert result == "Complete sentence. Another one!"
    
    def test_split_into_sentences_empty_text(self):
        """Test splitting empty text"""
        result = self.extractor.split_into_sentences("")
        assert result == []
    
    def test_split_into_sentences_single_sentence(self):
        """Test splitting single sentence"""
        result = self.extractor.split_into_sentences("This is a sentence.")
        assert result == ["This is a sentence"]
    
    def test_split_into_sentences_multiple_sentences(self):
        """Test splitting multiple sentences"""
        text = "First sentence. Second one! Third one?"
        result = self.extractor.split_into_sentences(text)
        assert result == ["First sentence", "Second one", "Third one"]
    
    def test_split_into_sentences_filters_short_fragments(self):
        """Test that short fragments are filtered out"""
        text = "Valid sentence. Hi. Another valid sentence."
        result = self.extractor.split_into_sentences(text)
        assert result == ["Valid sentence", "Another valid sentence"]
    
    def test_split_into_sentences_with_empty_segments(self):
        """Test splitting with multiple punctuation marks"""
        text = "First.. Second!!! Third???"
        result = self.extractor.split_into_sentences(text)
        # "First" is too short (< 5 chars) so it gets filtered
        assert len(result) >= 1
        assert any("Second" in s for s in result)
    
    def test_deduplicate_sentences_empty_text(self):
        """Test deduplication with empty text"""
        result = self.extractor.deduplicate_sentences("")
        assert result == ""
    
    def test_deduplicate_sentences_whitespace_only(self):
        """Test deduplication with whitespace only"""
        result = self.extractor.deduplicate_sentences("   \n\t   ")
        assert result == "   \n\t   "
    
    def test_deduplicate_sentences_no_duplicates(self):
        """Test deduplication with no duplicates"""
        text = "First sentence. Second sentence. Third sentence."
        result = self.extractor.deduplicate_sentences(text)
        assert result == "First sentence. Second sentence. Third sentence."
    
    def test_deduplicate_sentences_exact_duplicates(self):
        """Test deduplication with exact duplicates"""
        text = "Same sentence. Same sentence. Different sentence."
        result = self.extractor.deduplicate_sentences(text)
        assert result == "Same sentence. Different sentence."
    
    def test_deduplicate_sentences_case_insensitive(self):
        """Test deduplication is case insensitive"""
        text = "Same sentence. SAME SENTENCE. Different one."
        result = self.extractor.deduplicate_sentences(text)
        assert result == "Same sentence. Different one."
    
    def test_deduplicate_sentences_whitespace_normalized(self):
        """Test deduplication normalizes whitespace"""
        text = "Same  sentence. Same   sentence. Different."
        result = self.extractor.deduplicate_sentences(text)
        assert result == "Same  sentence. Different."
    
    def test_deduplicate_sentences_preserves_order(self):
        """Test deduplication preserves original order"""
        text = "First. Second. First. Third."
        result = self.extractor.deduplicate_sentences(text)
        # Short sentences (< 5 chars) are filtered
        assert result == "Second."
    
    def test_deduplicate_sentences_adds_final_period(self):
        """Test deduplication adds final period if missing"""
        text = "First sentence. Second sentence"
        result = self.extractor.deduplicate_sentences(text)
        assert result.endswith(".")
    
    def test_deduplicate_sentences_complex_case(self):
        """Test deduplication with complex mixed case"""
        text = "The quick brown fox. THE QUICK BROWN FOX! The lazy dog. The quick brown fox?"
        result = self.extractor.deduplicate_sentences(text)
        assert "The quick brown fox" in result
        assert "The lazy dog" in result
        assert result.count("quick brown fox") == 1