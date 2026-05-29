"""Centralized path utilities for writable VoiceTree directories."""

import os
from pathlib import Path


def get_voicetree_home_path() -> Path:
    """Returns the global VoiceTree home directory."""
    return Path(os.environ.get("VOICETREE_HOME_PATH", Path.home() / ".voicetree"))


def get_log_dir() -> Path:
    """Returns a writable directory for logs."""
    log_dir = get_voicetree_home_path() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def get_app_data_dir() -> Path:
    """Returns a writable directory for app data (debug logs, cache, etc.)."""
    data_dir = get_voicetree_home_path()
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir
