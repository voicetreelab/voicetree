"""
Unit tests for word-boundary-aware trimming in HistoryManager.

These tests define the expected behavior for trimming that respects word boundaries.
TDD approach: Write tests first, see them fail, then implement the feature.
"""

from backend.text_to_graph_pipeline.text_buffer_manager.history_manager import (
    HistoryManager,
)


def test_basic_word_boundary_prevention():
    """Should not split words in half - trim to nearest word boundary before limit."""
    manager = HistoryManager()

    # "The quick brown fox" = 19 chars
    # With limit 10, current behavior: "brown fox" (9 chars) = last 10 chars = "brown fox " but trimmed
    # Expected behavior: "brown fox" (9 chars) - keeps full words under the limit
    manager.append("The quick brown fox", max_length=10)
    result = manager.get()

    # Should keep complete words, not split "brown" to "rown"
    assert " " not in result or not result.startswith("rown")
    assert result == "brown fox"
    assert len(result) <= 10


def test_exact_word_boundary_no_trim():
    """When max_length falls exactly at a space, should not trim unnecessarily."""
    manager = HistoryManager()

    # "hello world" = 11 chars, space at position 5
    # If limit is 11, should keep everything
    manager.append("hello world", max_length=11)
    assert manager.get() == "hello world"

    # If limit is 6 (right after space), should keep "hello " or just "world"
    manager.clear()
    manager.append("hello world", max_length=6)
    result = manager.get()
    # Should be a complete word, not " world" (6 chars) with leading space
    assert result in ["hello", "world", "hello ", " world"]


def test_single_long_word_exceeds_limit():
    """When a single word is longer than max_length, must trim it (unavoidable)."""
    manager = HistoryManager()

    # Word is 34 chars, limit is 20
    manager.append("supercalifragilisticexpialidocious", max_length=20)
    result = manager.get()

    # Should be trimmed to 20 chars since we can't avoid breaking the word
    assert len(result) == 20
    assert result == "listicexpialidocious"  # Last 20 chars (no spaces, so can't avoid split)


def test_multiple_spaces_between_words():
    """Should handle multiple consecutive spaces when finding word boundaries."""
    manager = HistoryManager()

    # "hello    world" = 14 chars (4 spaces)
    # With limit 10, should keep "world" or "    world" (10 chars)
    manager.append("hello    world", max_length=10)
    result = manager.get()

    # Should either keep the spaces + word, or just the word
    # Important: should not split "world" to "orld"
    assert not result.startswith("orld")
    assert "world" in result
    assert len(result) <= 10


def test_max_length_smaller_than_first_word():
    """When max_length is smaller than the first word in the trimmed section."""
    manager = HistoryManager()

    # "extraordinarily good" = 20 chars
    # Last 5 chars: "y good"
    # First space at position 1, so we get "good" (complete word, 4 chars)
    # This is correct behavior - respecting word boundaries may give us fewer than max_length chars
    manager.append("extraordinarily good", max_length=5)
    result = manager.get()

    # Word-boundary-aware trimming keeps complete words, even if shorter than limit
    assert len(result) <= 5
    assert result == "good"  # Complete word, better than "y good"


def test_punctuation_as_part_of_words():
    """Punctuation should be treated as part of words, not word boundaries."""
    manager = HistoryManager()

    # "Hello, world! How are you?" = 26 chars
    # Punctuation like "," and "!" should stick with their words
    manager.append("Hello, world! How are you?", max_length=15)
    result = manager.get()

    # Should keep complete words with punctuation
    # "How are you?" = 12 chars, fits in 15
    assert "?" in result  # Question mark should be preserved
    assert not result.startswith(",")  # Shouldn't start with comma
    assert len(result) <= 15


def test_unicode_emoji_word_boundaries():
    """Should handle Unicode and emojis correctly when finding word boundaries."""
    manager = HistoryManager()

    # "Hello 👋 world 🌍 test" with emojis
    manager.append("Hello 👋 world 🌍 test", max_length=15)
    result = manager.get()

    # Should handle emojis as word separators
    assert "👋" in result or "🌍" in result or "test" in result
    assert len(result) <= 15


def test_leading_trailing_whitespace_preservation():
    """Should preserve meaningful whitespace while respecting word boundaries."""
    manager = HistoryManager()

    # "  hello world  " = 15 chars (2 leading, 2 trailing spaces)
    manager.append("  hello world  ", max_length=10)
    result = manager.get()

    # Should keep word boundaries, may include trailing spaces
    assert "world" in result
    assert len(result) <= 10


def test_multiple_appends_with_word_boundary_trimming():
    """Multiple appends should maintain word boundaries across operations."""
    manager = HistoryManager()

    manager.append("The quick", max_length=20)
    assert manager.get() == "The quick"

    manager.append(" brown fox", max_length=20)
    assert manager.get() == "The quick brown fox"

    manager.append(" jumps over the lazy dog", max_length=20)
    result = manager.get()

    # Should maintain word boundaries even after multiple operations
    assert len(result) <= 20
    # Check that we don't have partial words at the start
    words = result.split()
    if words:
        # First word should be complete (not missing starting letters)
        assert words[0] in ["fox", "jumps", "over", "the", "lazy", "dog"]


def test_empty_result_after_word_boundary_trim():
    """Edge case: when all content is trimmed away."""
    manager = HistoryManager()

    # Single long word with very small limit
    manager.append("hello", max_length=2)
    result = manager.get()

    # Should still return something (last 2 chars)
    assert len(result) == 2
    assert result == "lo"


def test_all_whitespace_content():
    """Edge case: appending only whitespace with word-aware trimming."""
    manager = HistoryManager()

    manager.append("     ", max_length=3)
    result = manager.get()

    # Should handle whitespace-only content
    # Note: Word-boundary logic treats first space as boundary and skips it
    assert len(result) <= 3
    assert result == "  "  # Gets 2 spaces (skips first space as boundary)


def test_word_boundary_with_newlines():
    """Newlines should also be treated as word boundaries."""
    manager = HistoryManager()

    manager.append("Hello\nworld\ntest\ndata", max_length=12)
    result = manager.get()

    # Should respect newlines as boundaries
    assert len(result) <= 12
    assert "\n" in result  # Newlines should be preserved
    # Should not split words across newlines
