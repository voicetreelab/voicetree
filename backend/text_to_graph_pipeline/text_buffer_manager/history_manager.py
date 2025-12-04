"""
History management utilities for transcript buffering.

Encapsulates spacing, trimming, and retrieval logic for the rolling transcript
history used by the agentic workflow prompts.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from backend.settings import TRANSCRIPT_HISTORY_MULTIPLIER, TEXT_BUFFER_SIZE_THRESHOLD


class HistoryManager:
    """Tracks processed transcript history with simple spacing and trimming."""

    def __init__(self, file_path: Optional[str] = None) -> None:
        self._history = ""
        self._file_path = file_path

        # Auto-load on initialization if file exists
        if self._file_path:
            self.load_from_file(self._file_path)

    def append(self, text: str, max_length: int) -> None:
        """
        Append processed text to history, inserting spacing when needed and
        trimming to the provided maximum length.

        Args:
            text: The text that was just flushed from the buffer.
            max_length: Maximum history length (characters). Values <= 0 disable trimming.
        """
        if not text:
            return

        if (
            self._history
            and not self._history[-1].isspace()
            and not text[0].isspace()
        ):
            self._history += " "

        # TODO: If upstream delivers routable/non-routable mixes out of order,
        # history will mirror that sequence. We may need to reconcile ordering once
        # buffering semantics are finalized.
        self._history += text

        if max_length > 0 and len(self._history) > max_length:
            # Word-boundary-aware trimming: avoid splitting words in half
            trimmed = self._history[-max_length:]

            # Find the first whitespace to skip any partial word at the start
            first_space_idx = None
            for i, char in enumerate(trimmed):
                if char.isspace():
                    first_space_idx = i
                    break

            if first_space_idx is not None:
                # Skip the partial word by taking everything after the first space
                self._history = trimmed[first_space_idx + 1:]
            else:
                # No whitespace found - entire section is one long word
                # Fall back to character-based trim (unavoidable)
                self._history = trimmed

        logging.debug(
            "[TRANSCRIPT_HISTORY] Added flushed text - Total history length: %s chars",
            len(self._history),
        )

        # Auto-save after each append if file path is set
        if self._file_path:
            self.save_to_file(self._file_path, text)

    def get(self, max_length: Optional[int] = TRANSCRIPT_HISTORY_MULTIPLIER*TEXT_BUFFER_SIZE_THRESHOLD) -> str:
        """
        Return the most recent history, optionally capped to the provided length.

        Args:
            max_length: Maximum length to return. None returns full history, 0 returns empty.
                       Negative values are treated as 0 (returns empty string).
        """
        if max_length is None:
            max_length = TRANSCRIPT_HISTORY_MULTIPLIER*TEXT_BUFFER_SIZE_THRESHOLD # todo, i know duped

        if max_length <= 0:
            return ""

        if len(self._history) > max_length:
            return self._history[-max_length:]
        return self._history

    def clear(self) -> None:
        """Reset recorded history."""
        self._history = ""
    def save_to_file(self, file_path: str, content: str) -> None:
        """
        Append content to the transcript history file.

        Args:
            file_path: Path where the transcript history should be saved
            content: The text content to append to the file
        """
        # IMPORTANT: The directory MUST already exist - if it doesn't, that's a bug
        # The output_dir should be created/managed by MarkdownTree or the calling code
        dir_path = os.path.dirname(file_path)
        if dir_path and not os.path.exists(dir_path):
            raise FileNotFoundError(f"Directory does not exist: {dir_path}. This is a bug - the directory should already exist.")

        # Append content to file
        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(content)

    def load_from_file(self, file_path: str) -> bool:
        """
        Load transcript history from a file.

        Args:
            file_path: Path to the transcript history file

        Returns:
            True if successfully loaded, False otherwise
        """
        if not os.path.exists(file_path):
            logging.debug(f"[TRANSCRIPT_HISTORY] File not found: {file_path}")
            return False

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                self._history = f.read()

            # logging.info(f"[TRANSCRIPT_HISTORY] Loaded {len(self._history)} chars from {file_path}")
            return True

        except Exception as e:
            logging.error(f"[TRANSCRIPT_HISTORY] Error loading from {file_path}: {e}")
            return False
