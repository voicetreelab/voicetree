"""
Fuzzy text matching for buffer management.

This module provides fuzzy text matching capabilities to handle minor text
variations that occur when LLMs process text (e.g., punctuation changes,
whitespace differences, minor word modifications).
"""

from typing import Tuple, Optional
import logging
from rapidfuzz import fuzz
from rapidfuzz.fuzz import partial_ratio_alignment


class FuzzyTextMatcher:
    """
    Handles fuzzy text matching for finding and removing completed text from buffers.
    
    This is designed to handle common LLM text modifications such as:
    - Punctuation changes (e.g., "Hello, world" → "Hello world")
    - Whitespace variations
    - Minor word changes (e.g., "sat" → "sits")
    - Text length variations (within reasonable bounds)
    """
    
    def __init__(self, similarity_threshold: float = 80):
        """
        Initialize the fuzzy text matcher.
        
        Args:
            similarity_threshold: Minimum similarity score (0-100) required for a match.
                                Default is 80 (80% similarity).
                                Note: RapidFuzz uses 0-100 scale, not 0-1.
        """
        self.similarity_threshold = similarity_threshold
        
    def find_best_match(self, target_text: str, source_text: str) -> Optional[Tuple[int, int, float]]:
        """
        Find the best match for target_text within source_text using fuzzy matching.
        
        Uses RapidFuzz's partial_ratio_alignment for efficient fuzzy substring matching.
        
        Args:
            target_text: The text to search for (e.g., completed text from workflow)
            source_text: The text to search in (e.g., current buffer contents)
            
        Returns:
            Tuple of (start_pos, end_pos, similarity_score) if match found above threshold,
            None if no good match found.
        """
        if not target_text or not source_text:
            return None
        
        # First try exact substring match for performance
        if target_text in source_text:
            start = source_text.index(target_text)
            end = start + len(target_text)
            
            # Extend match to include trailing punctuation if present
            while end < len(source_text) and source_text[end] in '.!?,;:':
                end += 1
                
            logging.info(f"Found exact match at position {start}-{end}")
            return (start, end, 100.0)
        
        # Check if the entire texts are similar enough (handles punctuation differences)
        overall_similarity = fuzz.ratio(target_text, source_text)
        if overall_similarity >= self.similarity_threshold and len(target_text) >= len(source_text) * 0.8:
            # If the texts are very similar overall and target is most of source,
            # consider it a full match
            return (0, len(source_text), overall_similarity)
        
        # Use RapidFuzz's partial_ratio_alignment for fuzzy substring matching
        # This finds the best matching substring in source_text
        alignment = partial_ratio_alignment(target_text, source_text)
        score = alignment.score
        
        if score >= self.similarity_threshold:
            # Get the aligned substring positions
            start = alignment.dest_start
            end = alignment.dest_end
            
            # Extend match to include trailing punctuation if present
            original_end = end
            while end < len(source_text) and source_text[end] in '.!?,;:':
                end += 1
            if end > original_end:
                logging.debug(f"Extended match from {original_end} to {end} to include punctuation")
            
            logging.info(f"Found fuzzy match with {score:.2f} similarity at position {start}-{end}")
            return (start, end, score)
        
        return None
        
    def remove_matched_text(self, source_text: str, target_text: str) -> Tuple[str, bool]:
        """
        Remove the best fuzzy match of target_text from source_text.
        
        Args:
            source_text: The text to remove from
            target_text: The text to search for and remove
            
        Returns:
            Tuple of (modified_text, success_flag)
            If no match found above threshold, returns (source_text, False)
        """
        match = self.find_best_match(target_text, source_text)
        
        if match:
            start, end, score = match
            # Remove the matched portion
            result = source_text[:start] + source_text[end:]
            # Clean up whitespace
            result = result.strip()
            return (result, True)
        else:
            logging.warning(f"No match found above {self.similarity_threshold}% threshold")
            return (source_text, False)
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """
        Calculate similarity score between two texts.
        
        Uses RapidFuzz for fast and robust comparison.
        
        Args:
            text1: First text to compare
            text2: Second text to compare
            
        Returns:
            Similarity score between 0 and 100, where 100 is perfect match
        """
        # Use RapidFuzz's ratio for general similarity
        # Note: RapidFuzz returns scores 0-100, not 0-1
        return fuzz.ratio(text1, text2)