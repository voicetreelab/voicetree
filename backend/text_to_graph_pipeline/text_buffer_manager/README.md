# Text Buffer Manager

This module handles text buffering and processing for the VoiceTree pipeline.

## Components

### TextBufferManager
- Accumulates voice transcription text until threshold is reached
- Maintains transcript history for context
- Triggers processing when buffer size exceeds threshold (default: 83 characters)
- Uses fuzzy text matching to remove processed text

### FuzzyTextMatcher
- Handles fuzzy text matching to accommodate LLM modifications
- Uses variable-length sliding window (80%-120% of target text)
- Requires 80% similarity threshold for matches
- Automatically extends matches to include trailing punctuation

### BufferConfig
- Configuration for buffer behavior
- `buffer_size_threshold`: Characters needed to trigger processing
- `transcript_history_multiplier`: How much history to maintain
- Other legacy settings maintained for compatibility

## Usage

```python
from text_buffer_manager import TextBufferManager

# Create buffer manager
buffer = TextBufferManager()

# Add text - returns BufferResult with is_ready flag
result = buffer.add_text("Some transcribed text...")
if result.is_ready:
    # Process result.text through workflow
    # Then flush completed text
    buffer.flush_completed_text(completed_text)
```

## Key Features

1. **Fuzzy Matching**: Handles minor LLM text modifications
2. **Race Condition Safe**: Preserves text added during processing
3. **Simple API**: Clear methods for adding text and flushing completed portions
4. **Development Errors**: Raises errors when similarity is too low (< 80%)

See `buffer_management_handover.md` for detailed implementation notes.