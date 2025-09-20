"""
Fuzzy text matching for buffer management.

This module provides fuzzy text matching capabilities to handle minor text
variations that occur when LLMs process text (e.g., punctuation changes,
whitespace differences, minor word modifications).
"""

import logging
from typing import List
from typing import Optional
from typing import Tuple

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
        if alignment is None:
            return None

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
        #todo this code is really buggy and unnecessary

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
                matched_ranges: List[Tuple[int, int]] = []
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
                            # Include the space before the first matched word
                            char_start = len(' '.join(source_words[:first_word_idx])) + 1
                        
                        # Calculate end position to include the matched text
                        char_end = len(' '.join(source_words[:last_word_idx + 1]))
                        
                        # Ensure we don't exceed source text bounds
                        char_start = max(0, min(char_start, len(source_text)))
                        char_end = min(len(source_text), char_end)
                        
                        # CRITICAL FIX: Ensure we end at a word boundary
                        # If char_end is not at the end of text and not followed by a space,
                        # we need to extend to the next word boundary
                        if char_end < len(source_text) and source_text[char_end] != ' ':
                            # Find the next space or end of text
                            next_space = source_text.find(' ', char_end)
                            if next_space != -1:
                                char_end = next_space
                            else:
                                char_end = len(source_text)
                        
                        # Debug logging to trace the issue
                        matched_text = source_text[char_start:char_end]
                        logging.debug(f"Match calculation: first_word_idx={first_word_idx}, last_word_idx={last_word_idx}")
                        logging.debug(f"Character positions: start={char_start}, end={char_end}")
                        logging.debug(f"Matched text: '{matched_text}'")
                        
                        # Calculate similarity score based on matched words
                        score = float(target_idx / len(target_words)) * 100.0
                        
                        if score > best_score:
                            best_score = int(score)
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
            before_text = source_text[:start]
            after_text = source_text[end:]
            matched_portion = source_text[start:end]
            
            logging.debug(f"Removing text - Match positions: start={start}, end={end}")
            logging.debug(f"Matched portion: '{matched_portion}'")
            logging.debug(f"Before text: '{before_text}'")
            logging.debug(f"After text: '{after_text}'")
            
            # Ensure we maintain proper spacing between remaining parts
            # If before_text doesn't end with space and after_text doesn't start with space,
            # we need to add a space to prevent word concatenation
            if before_text and after_text and not before_text.endswith(' ') and not after_text.startswith(' '):
                result = before_text + ' ' + after_text
            else:
                result = before_text + after_text
            
            # Clean up any double spaces
            result = ' '.join(result.split())
            logging.debug(f"Final result: '{result}'")
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