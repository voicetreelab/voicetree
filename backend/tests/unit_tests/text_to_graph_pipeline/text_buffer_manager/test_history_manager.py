from backend.text_to_graph_pipeline.text_buffer_manager.history_manager import (
    HistoryManager,
)


def test_append_inserts_space_between_alpha_segments():
    manager = HistoryManager()
    manager.append("Hello", max_length=100)
    manager.append("world", max_length=100)
    assert manager.get() == "Hello world"


def test_append_respects_existing_whitespace():
    manager = HistoryManager()
    manager.append("Hello", max_length=100)
    manager.append(" again", max_length=100)
    assert manager.get() == "Hello again"


def test_append_handles_punctuation_without_extra_space():
    manager = HistoryManager()
    manager.append("Ends with period.", max_length=100)
    manager.append("Next sentence", max_length=100)
    assert manager.get() == "Ends with period. Next sentence"


def test_append_ignores_empty_text():
    manager = HistoryManager()
    manager.append("", max_length=100)
    assert manager.get() == ""


def test_append_trims_to_max_length():
    manager = HistoryManager()
    manager.append("1234567890", max_length=8)
    assert manager.get() == "34567890"


def test_get_with_zero_returns_empty_string():
    manager = HistoryManager()
    manager.append("hello", max_length=100)
    assert manager.get(0) == ""


def test_get_with_positive_length_returns_tail():
    manager = HistoryManager()
    manager.append("abcdefghij", max_length=100)
    assert manager.get(4) == "ghij"


def test_get_with_negative_length_returns_empty():
    """Negative max_length now returns empty string (legacy behavior removed)."""
    manager = HistoryManager()
    manager.append("abcdefghij", max_length=0)
    assert manager.get(-3) == ""  # Treated as <= 0


def test_clear_resets_history():
    manager = HistoryManager()
    manager.append("hello", max_length=100)
    manager.clear()
    assert manager.get() == ""


def test_append_with_negative_max_length_no_trimming():
    """Negative max_length in append should disable trimming."""
    manager = HistoryManager()
    manager.append("1234567890", max_length=-5)
    assert manager.get() == "1234567890"  # Full text preserved


def test_append_with_zero_max_length_no_trimming():
    """Zero max_length in append should disable trimming."""
    manager = HistoryManager()
    manager.append("1234567890", max_length=0)
    assert manager.get() == "1234567890"  # Full text preserved


def test_append_text_longer_than_max_length():
    """When appended text itself is longer than max_length."""
    manager = HistoryManager()
    manager.append("This is a very long text that exceeds the limit", max_length=10)
    # Word-boundary-aware: keeps complete words, no leading space
    assert manager.get() == "the limit"
    assert len(manager.get()) <= 10


def test_multiple_appends_with_trimming():
    """Multiple appends should maintain max_length constraint."""
    manager = HistoryManager()
    manager.append("first", max_length=15)
    manager.append("second", max_length=15)
    manager.append("third", max_length=15)
    # "first second third" is 18 chars, word-boundary-aware keeps complete words
    assert len(manager.get()) <= 15
    assert manager.get() == "second third"  # No partial "first" → clean result


def test_append_handles_multiple_consecutive_spaces():
    """Multiple spaces should be preserved within text."""
    manager = HistoryManager()
    manager.append("hello  ", max_length=100)
    manager.append("  world", max_length=100)
    assert manager.get() == "hello    world"  # Spaces preserved


def test_append_handles_unicode_and_emojis():
    """Unicode characters and emojis should be handled correctly."""
    manager = HistoryManager()
    manager.append("Hello 👋", max_length=100)
    manager.append("世界", max_length=100)
    assert manager.get() == "Hello 👋 世界"


def test_append_empty_history_with_whitespace_start():
    """Appending text starting with whitespace to empty history."""
    manager = HistoryManager()
    manager.append("  hello", max_length=100)
    assert manager.get() == "  hello"  # Leading spaces preserved


def test_get_with_length_exceeding_history():
    """Getting with max_length larger than actual history."""
    manager = HistoryManager()
    manager.append("short", max_length=100)
    assert manager.get(1000) == "short"  # Returns full history


def test_word_boundary_split_on_trim():
    """Word-boundary-aware trimming keeps complete words."""
    manager = HistoryManager()
    manager.append("The quick brown fox jumps", max_length=10)
    result = manager.get()
    # Word-boundary-aware: may return fewer than max_length to keep complete words
    assert len(result) <= 10
    assert result == "fox jumps"  # Complete words, no split!


def test_append_only_whitespace():
    """Appending only whitespace text."""
    manager = HistoryManager()
    manager.append("hello", max_length=100)
    manager.append("   ", max_length=100)
    manager.append("world", max_length=100)
    # When appending pure whitespace, no extra space is added before next word
    assert manager.get() == "hello   world"


# Tests consolidated from test_history_manager_quirks.py
def test_negative_length_behavior_is_consistent():
    """
    Verify that negative length behavior is now consistent and simple.
    Negative values are treated as 0 (returns empty string).
    """
    manager = HistoryManager()
    manager.append("0123456789", max_length=0)  # No trimming

    # Positive length: returns LAST N characters
    assert manager.get(5) == "56789"

    # Negative length: returns empty (simple and consistent!)
    assert manager.get(-5) == ""
    assert manager.get(-3) == ""
    assert manager.get(-10) == ""


def test_word_boundary_preserves_context():
    """Test that word-boundary trimming preserves readability and context."""
    manager = HistoryManager()

    # Example: Person's name is preserved
    manager.clear()
    manager.append("Meeting with Alexander Hamilton about finances", max_length=25)
    result = manager.get()
    assert result == "Hamilton about finances"  # Complete name preserved
    assert len(result) <= 25

    # Example: Important keywords are kept complete
    manager.clear()
    manager.append("The authentication system needs refactoring", max_length=15)
    result = manager.get()
    assert result == "refactoring"  # Complete word, meaning clear
    assert len(result) <= 15


def test_multi_byte_character_handling():
    """
    Test that multi-byte characters (emojis, Unicode) are handled correctly.
    Python handles this well, but it's good to have explicit tests.
    """
    manager = HistoryManager()

    # Emoji handling
    manager.append("Hello 👋 World 🌍 Test", max_length=10)
    result = manager.get()
    assert len(result) <= 10
    # Should contain complete words/emojis

    # Chinese characters
    manager.clear()
    manager.append("你好世界 Hello", max_length=8)
    result = manager.get()
    assert len(result) <= 8
    # Should handle multi-byte chars correctly


def test_history_manager_with_file_path_in_nonexistent_directory(tmp_path):
    """
    Test that HistoryManager with a file path fails gracefully when directory doesn't exist.
    This tests the bug where HistoryManager.append() tries to save to a file in a directory
    that doesn't exist yet.
    """
    import os

    # Create a path to a file in a directory that doesn't exist
    nonexistent_dir = tmp_path / "voicetree-test-temp"
    file_path = str(nonexistent_dir / "transcript_history.txt")

    # Directory should not exist yet
    assert not os.path.exists(nonexistent_dir)

    # Initialize HistoryManager with file path in non-existent directory
    # This should NOT crash - the directory issue should be caught on append
    manager = HistoryManager(file_path)

    # This should raise FileNotFoundError because directory doesn't exist
    try:
        manager.append("test text", max_length=100)
        assert False, "Expected FileNotFoundError but none was raised"
    except FileNotFoundError as e:
        assert "Directory does not exist" in str(e)
        assert str(nonexistent_dir) in str(e)


def test_save_to_file_appends_newline_after_each_chunk(tmp_path):
    """Each chunk written to transcript_history.txt should end with a newline."""
    file_path = str(tmp_path / "transcript_history.txt")
    manager = HistoryManager(file_path)

    manager.append("first chunk", max_length=1000)
    manager.append("second chunk", max_length=1000)
    manager.append("third chunk", max_length=1000)

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    assert lines == ["first chunk\n", "second chunk\n", "third chunk\n"]
