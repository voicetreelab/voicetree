"""
Sentence extraction utilities for buffer management
"""

import re
from typing import List


class SentenceExtractor:
    """Handles sentence extraction and text processing"""
    
    def extract_complete_sentences(self, text: str) -> str:
        """
        Extract complete sentences from text, leaving incomplete ones.
        
        Args:
            text: Input text that may contain incomplete sentences
            
        Returns:
            String containing only complete sentences
        """
        if not text:
            return ""
        
        # Handle ellipses as incomplete sentences
        if text.rstrip().endswith('...'):
            return self._extract_before_ellipses(text)
        
        # Find all complete sentences (ending with . ! or ? but not ...)
        matches = re.findall(r'[^.!?]*[.!?](?![.])', text)
        
        if matches:
            return ''.join(matches).strip()
        
        return ""  # No complete sentences found
    
    def _extract_before_ellipses(self, text: str) -> str:
        """Extract complete sentences before ellipses"""
        parts = text.split('...')
        if len(parts) > 1:
            text_before = '...'.join(parts[:-1])
            if text_before.strip():
                matches = re.findall(r'[^.!?]*[.!?]', text_before)
                if matches:
                    return ''.join(matches).strip()
        return ""
    
    def split_into_sentences(self, text: str) -> List[str]:
        """
        Split text into individual sentences.
        
        Args:
            text: Input text
            
        Returns:
            List of sentences
        """
        if not text:
            return []
        
        # Split on sentence endings
        sentences = re.split(r'[.!?]+', text)
        
        # Clean and filter
        result = []
        for sentence in sentences:
            sentence = sentence.strip()
            if sentence and len(sentence) > 5:  # Ignore very short fragments
                result.append(sentence)
        
        return result
    
    def deduplicate_sentences(self, text: str) -> str:
        """
        Remove duplicate sentences from text.
        
        Args:
            text: Input text that may contain duplicates
            
        Returns:
            Text with duplicates removed
        """
        if not text or not text.strip():
            return text
        
        sentences = self.split_into_sentences(text)
        seen_normalized = set()
        unique_sentences = []
        
        for sentence in sentences:
            # Normalize for comparison
            normalized = ' '.join(sentence.lower().split())
            
            if normalized not in seen_normalized:
                seen_normalized.add(normalized)
                unique_sentences.append(sentence)
        
        # Rejoin with proper punctuation
        result = '. '.join(unique_sentences)
        if result and not result.endswith('.'):
            result += '.'
        
        return result