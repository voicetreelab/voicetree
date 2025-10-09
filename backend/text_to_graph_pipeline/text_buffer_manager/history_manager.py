"""
History management utilities for transcript buffering.

Encapsulates spacing, trimming, and retrieval logic for the rolling transcript
history used by the agentic workflow prompts.
"""

from __future__ import annotations

import logging
from typing import Optional


class HistoryManager:
    """Tracks processed transcript history with simple spacing and trimming."""

    def __init__(self) -> None:
        self._history = ""

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

    def get(self, max_length: Optional[int] = None) -> str:
        """Return the most recent history, optionally capped to the provided length."""
        if max_length is None:
            return self._history

        if max_length == 0:
            return ""

        if max_length > 0:
            if len(self._history) > max_length:
                return self._history[-max_length:]
            return self._history

        # Legacy behaviour for negative values: drop the first abs(max_length) characters
        limit = -max_length
        if len(self._history) > limit:
            return self._history[limit:]
        return self._history

    def clear(self) -> None:
        """Reset recorded history."""
        self._history = ""
