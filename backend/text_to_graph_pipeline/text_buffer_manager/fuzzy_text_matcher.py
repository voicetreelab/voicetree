"""
Fuzzy text matching for buffer management.

This module provides fuzzy text matching capabilities to handle minor text
variations that occur when LLMs process text (e.g., punctuation changes,
whitespace differences, minor word modifications).
"""

from typing import Tuple, Optional
from difflib import SequenceMatcher
import logging


class FuzzyTextMatcher:
    """
    Handles fuzzy text matching for finding and removing completed text from buffers.
    
    This is designed to handle common LLM text modifications such as:
    - Punctuation changes (e.g., "Hello, world" → "Hello world")
    - Whitespace variations
    - Minor word changes (e.g., "sat" → "sits")
    - Text length variations (within reasonable bounds)
    """
    
    def __init__(self, similarity_threshold: float = 0.8):
        """
        Initialize the fuzzy text matcher.
        
        Args:
            similarity_threshold: Minimum similarity score (0-1) required for a match.
                                Default is 0.8 (80% similarity).
        """
        self.similarity_threshold = similarity_threshold
        
    def find_best_match(self, target_text: str, source_text: str) -> Optional[Tuple[int, int, float]]:
        """
        Find the best match for target_text within source_text using fuzzy matching.
        
        Uses a variable-length sliding window approach to handle text that may have
        been slightly modified by an LLM during processing.
        
        Args:
            target_text: The text to search for (e.g., completed text from workflow)
            source_text: The text to search in (e.g., current buffer contents)
            
        Returns:
            Tuple of (start_pos, end_pos, similarity_score) if match found above threshold,
            None if no good match found.
        """
        if not target_text or not source_text:
            return None
            
        target_len = len(target_text)
        source_len = len(source_text)
        
        # Search for windows 80% to 120% of target text length
        min_window = int(target_len * 0.8)
        max_window = min(int(target_len * 1.2), source_len)
        
        best_score = 0
        best_start = 0
        best_end = 0
        
        # Try different window sizes
        for window_size in range(min_window, max_window + 1):
            # Slide this window size across the source text
            for start in range(source_len - window_size + 1):
                window = source_text[start:start + window_size]
                
                # Calculate similarity score
                score = self._calculate_similarity(target_text, window)
                
                if score > best_score:
                    best_score = score
                    best_start = start
                    best_end = start + window_size
        
        # Extend match to include trailing punctuation if present
        if best_score >= self.similarity_threshold:
            while best_end < source_len and source_text[best_end] in '.!?,;:':
                best_end += 1
                
            logging.info(f"Found match with {best_score:.2%} similarity at position {best_start}-{best_end}")
            return (best_start, best_end, best_score)
        
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
            logging.warning(f"No match found above {self.similarity_threshold:.0%} threshold")
            return (source_text, False)
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """
        Calculate similarity score between two texts.
        
        Uses difflib's SequenceMatcher for robust character-level comparison
        that handles most LLM modifications well.
        
        Args:
            text1: First text to compare
            text2: Second text to compare
            
        Returns:
            Similarity score between 0 and 1, where 1 is perfect match
        """
        # Normalize whitespace but preserve other differences
        t1 = " ".join(text1.split())
        t2 = " ".join(text2.split())
        
        # Use SequenceMatcher's ratio - handles typos, punctuation changes, etc.
        return SequenceMatcher(None, t1, t2).ratio()