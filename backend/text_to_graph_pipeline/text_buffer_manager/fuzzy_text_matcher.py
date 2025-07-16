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
        
        # Special case: if target and source are very similar overall (e.g., only punctuation differences)
        # and they're roughly the same length, treat as a full match
        # This handles cases like "Hello world How are you" matching "Hello, world! How are you?"
        if abs(len(target_text) - len(source_text)) <= 10:  # Allow small length differences
            overall_similarity = fuzz.ratio(target_text, source_text)
            if overall_similarity >= 88:  # High threshold for full-text match
                logging.debug(f"Using full-text match with {overall_similarity:.0f}% similarity")
                return (0, len(source_text), overall_similarity)
        
        # Try tokenization-aware matching for cases where text has been split/rejoined
        # This handles cases where the workflow processes non-contiguous chunks
        normalized_match = self._find_tokenized_match(target_text, source_text)
        if normalized_match:
            return normalized_match
        else:
            logging.debug("Tokenized match failed, falling back to partial_ratio_alignment")
        
        # Use RapidFuzz's partial_ratio_alignment for fuzzy substring matching
        # This finds the best matching substring in source_text
        alignment = partial_ratio_alignment(target_text, source_text)
        score = alignment.score
        
        logging.debug(f"Partial ratio alignment: score={score}, start={alignment.dest_start}, end={alignment.dest_end}")
        
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
        
        # Log more details about why the match failed
        logging.debug(f"No match found. Target length: {len(target_text)}, Source length: {len(source_text)}, Score: {score}")
        
        # Additional debugging for very low scores
        if score < 50:
            # Check if texts start the same
            common_prefix_len = 0
            for i in range(min(len(target_text), len(source_text))):
                if target_text[i] == source_text[i]:
                    common_prefix_len += 1
                else:
                    break
            if common_prefix_len > 50:
                logging.warning(f"Texts have {common_prefix_len} character common prefix but score is only {score}. "
                              f"This suggests non-contiguous text chunks.")
        
        return None
    
    def _find_tokenized_match(self, target_text: str, source_text: str) -> Optional[Tuple[int, int, float]]:
        """
        Find matches for text that may have been tokenized and reconstructed.
        
        This handles cases where:
        - Text was split into words and rejoined (whitespace normalization)
        - Non-contiguous chunks were processed (words may be missing)
        
        Args:
            target_text: The text to search for
            source_text: The text to search in
            
        Returns:
            Match tuple if found, None otherwise
        """
        # Tokenize both texts
        target_words = target_text.split()
        source_words = source_text.split()
        
        if not target_words or not source_words:
            return None
        
        # For non-contiguous chunk matching, we need to find where target words
        # appear in the source, potentially with gaps
        best_match = None
        best_score = 0
        
        # Try to find the sequence of target words in source
        # Allow for missing words (incomplete chunks)
        for start_idx in range(len(source_words)):
            if source_words[start_idx] == target_words[0]:
                # Found potential start, try to match as many words as possible
                matched_ranges = []
                source_idx = start_idx
                target_idx = 0
                
                while target_idx < len(target_words) and source_idx < len(source_words):
                    # Look for the next target word in remaining source words
                    found = False
                    for offset in range(min(10, len(source_words) - source_idx)):  # Allow gaps up to 10 words
                        if source_idx + offset < len(source_words) and source_words[source_idx + offset] == target_words[target_idx]:
                            if matched_ranges and source_idx + offset > matched_ranges[-1][1] + 1:
                                # There's a gap, this might be a non-contiguous match
                                pass
                            matched_ranges.append((source_idx + offset, source_idx + offset))
                            source_idx = source_idx + offset + 1
                            target_idx += 1
                            found = True
                            break
                    
                    if not found:
                        break
                
                # Calculate match quality
                if target_idx > len(target_words) * 0.8:  # Matched at least 80% of target words
                    # Find the span in the original text
                    if matched_ranges:
                        first_word_idx = matched_ranges[0][0]
                        last_word_idx = matched_ranges[-1][1]
                        
                        # Convert word indices back to character positions
                        # Calculate positions more accurately
                        if first_word_idx == 0:
                            char_start = 0
                        else:
                            char_start = len(' '.join(source_words[:first_word_idx])) + 1
                        
                        char_end = len(' '.join(source_words[:last_word_idx + 1]))
                        
                        # Ensure we don't exceed source text bounds
                        char_start = max(0, min(char_start, len(source_text)))
                        char_end = min(len(source_text), char_end)
                        
                        # Calculate similarity score based on matched words
                        score = (target_idx / len(target_words)) * 100
                        
                        if score > best_score:
                            best_score = score
                            best_match = (char_start, char_end, score)
        
        if best_match and best_score >= self.similarity_threshold:
            logging.info(f"Found tokenized match with {best_score:.0f}% word coverage")
            return best_match
        elif best_match:
            logging.debug(f"Tokenized match score {best_score:.0f}% below threshold {self.similarity_threshold}%")
        else:
            logging.debug(f"No tokenized match found for {len(target_words)} target words in {len(source_words)} source words")
        
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