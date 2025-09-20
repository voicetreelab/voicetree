"""
Unit tests for FuzzyTextMatcher
"""

from backend.text_to_graph_pipeline.text_buffer_manager import FuzzyTextMatcher


class TestFuzzyTextMatcher:
    """Test suite for FuzzyTextMatcher"""
    
    def test_initialization(self):
        """Test matcher initialization"""
        matcher = FuzzyTextMatcher(similarity_threshold=90)
        assert matcher.similarity_threshold == 90
        
        # Default threshold
        matcher = FuzzyTextMatcher()
        assert matcher.similarity_threshold == 80
    
    def test_exact_match(self):
        """Test exact text matching"""
        matcher = FuzzyTextMatcher()
        
        source = "Hello world. How are you?"
        target = "Hello world."
        
        match = matcher.find_best_match(target, source)
        assert match is not None
        assert match[0] == 0  # Start position
        assert match[1] == 12  # End position (includes period)
        assert match[2] > 99  # Near perfect score
    
    def test_fuzzy_whitespace_match(self):
        """Test matching with different whitespace"""
        matcher = FuzzyTextMatcher(similarity_threshold=70)  # Lower threshold for whitespace variations
        
        source = "Hello    world.   How are you?"
        target = "Hello world."
        
        match = matcher.find_best_match(target, source)
        assert match is not None
        assert match[2] > 70  # Good similarity despite whitespace
    
    def test_minor_word_changes(self):
        """Test matching with minor word variations"""
        matcher = FuzzyTextMatcher()
        
        source = "The cat sat on the mat."
        target = "The cat sits on the mat."
        
        match = matcher.find_best_match(target, source)
        assert match is not None
        assert match[2] > 85  # Good similarity despite verb change
    
    def test_punctuation_extension(self):
        """Test that matches extend to include trailing punctuation"""
        matcher = FuzzyTextMatcher()
        
        source = "Hello world! How are you?"
        target = "Hello world"  # No punctuation in target
        
        match = matcher.find_best_match(target, source)
        assert match is not None
        assert source[match[0]:match[1]] == "Hello world!"  # Includes punctuation
    
    def test_no_match_below_threshold(self):
        """Test that low similarity returns None"""
        matcher = FuzzyTextMatcher(similarity_threshold=80)
        
        source = "Completely different text"
        target = "Hello world"
        
        match = matcher.find_best_match(target, source)
        assert match is None
    
    def test_remove_matched_text(self):
        """Test text removal functionality"""
        matcher = FuzzyTextMatcher()
        
        source = "Hello world. How are you?"
        target = "Hello world."
        
        result, success = matcher.remove_matched_text(source, target)
        assert success
        assert result == "How are you?"
    
    def test_remove_matched_text_from_middle(self):
        """Test removing text from middle of source"""
        matcher = FuzzyTextMatcher()
        
        source = "Start text. Middle part. End text."
        target = "Middle part."
        
        result, success = matcher.remove_matched_text(source, target)
        assert success
        # Normalize whitespace for comparison
        assert " ".join(result.split()) == "Start text. End text."
    
    def test_variable_length_matching(self):
        """Test matching with different length windows"""
        matcher = FuzzyTextMatcher(similarity_threshold=70)  # Lower threshold for variations
        
        source = "Hello my world. Next part."
        target = "Hello world."
        
        match = matcher.find_best_match(target, source)
        assert match is not None
        # Should match "Hello my world." despite extra word
        assert match[2] > 70
    
    def test_empty_text_handling(self):
        """Test handling of empty texts"""
        matcher = FuzzyTextMatcher()
        
        assert matcher.find_best_match("", "some text") is None
        assert matcher.find_best_match("some text", "") is None
        assert matcher.find_best_match("", "") is None
        
        result, success = matcher.remove_matched_text("", "test")
        assert not success
        assert result == ""