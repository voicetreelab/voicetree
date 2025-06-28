## Architectural Analysis

The fundamental issue is the mismatch between:
- **Character-based buffering** (83 chars) that cuts text arbitrarily
- **Semantic processing** that expects complete thoughts

This causes the segmentation stage to artificially create coherence from fragments, leading to poor quality output.

## Recommended Solution (80/20 Approach)

Instead of the complex multi-stage fix, a simpler solution would be:

### Alternative Approach
A sentence-aware buffer would achieve 80% of the benefit with ~10 lines of code:
```python
def add_text(self, text: str) -> BufferResult:
    self._buffer += text
    
    # Extract complete sentences
    sentences = re.split(r'(?<=[.!?])\s+', self._buffer)
    if len(sentences) > 1:
        complete = ' '.join(sentences[:-1])
        self._buffer = sentences[-1]
        return BufferResult(is_ready=True, text=complete)
    
    return BufferResult(is_ready=False)
```

This would prevent mid-sentence cuts without requiring changes to prompts, workflows, or tests.