"""Shared logging configuration for VoiceTree."""

import logging

from backend.paths import get_log_dir


def setup_logging(log_file_name: str = 'voicetree.log', console_level: int = logging.ERROR) -> logging.Logger:
    """
    Set up logging configuration with file and console handlers.

    Args:
        log_file_name: Name of the log file (will be placed in system log directory)
        console_level: Logging level for console output
    """
    # Get or create root logger
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)

    # Remove any existing handlers to avoid duplicates
    logger.handlers.clear()

    # Console handler (customizable level)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(console_level)
    console_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(console_handler)

    # File handler for all logs (INFO and above) - fail gracefully if not writable
    try:
        log_file_path = get_log_dir() / log_file_name
        file_handler = logging.FileHandler(log_file_path)
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
        logger.addHandler(file_handler)
    except (PermissionError, OSError):
        pass  # Skip file logging if we can't write

    return logger
