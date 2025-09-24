"""
Pytest configuration and fixtures for cross-system tests.
"""

import pytest
import tempfile
import shutil
import os
from pathlib import Path


@pytest.fixture
def temp_markdown_dir():
    """Create a temporary directory for markdown files during testing."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)


@pytest.fixture
def test_text_samples():
    """Sample text inputs for testing."""
    return {
        "simple": "Hello VoiceTree, I want to discuss several important software engineering concepts. First, let's talk about microservices architecture and how it differs from monolithic applications. Microservices provide better scalability and maintainability. Next, I want to explain the importance of continuous integration and deployment pipelines. These practices ensure code quality and faster delivery. Finally, let's explore database design patterns including normalization and denormalization strategies.",
        "complex": "I want to discuss the architecture of VoiceTree. It uses agentic workflows to process text into structured graphs. The system converts voice input into markdown files that represent concepts and ideas. This is a complex system with many components.",
        "multi_concept": "First, let's talk about machine learning and how it processes data and creates models. Then we should discuss data structures like arrays, trees, and graphs. Finally, we need to cover algorithms including sorting, searching, and optimization techniques."
    }