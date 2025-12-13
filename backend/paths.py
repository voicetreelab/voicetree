"""Centralized path utilities for writable app directories."""

import sys
from pathlib import Path


def get_log_dir() -> Path:
    """Returns a writable directory for logs."""
    if sys.platform == "darwin":
        log_dir = Path.home() / "Library" / "Logs" / "VoiceTree"
    elif sys.platform == "win32":
        import os
        log_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "VoiceTree" / "logs"
    else:
        log_dir = Path.home() / ".voicetree" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def get_app_data_dir() -> Path:
    """Returns a writable directory for app data (debug logs, cache, etc.)."""
    if sys.platform == "darwin":
        data_dir = Path.home() / "Library" / "Application Support" / "VoiceTree"
    elif sys.platform == "win32":
        import os
        data_dir = Path(os.environ.get("APPDATA", Path.home())) / "VoiceTree"
    else:
        data_dir = Path.home() / ".voicetree"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir
