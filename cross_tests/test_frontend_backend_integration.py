"""
Frontend-Backend Integration Tests for VoiceTree POC Web App

Tests the complete workflow from HTTP request to markdown file creation.
"""

import asyncio
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any
from typing import Dict

import pytest
import requests


class ServerManager:
    """Manages the VoiceTree server process for testing."""

    def __init__(self, temp_markdown_dir: str):
        self.temp_markdown_dir = temp_markdown_dir
        self.process = None
        self.server_url = "http://localhost:8000"

    def start(self) -> None:
        """Start the server process."""
        # Create date subdirectory structure like main system
        from datetime import datetime
        date_str = datetime.now().strftime("%Y-%m-%d")
        date_dir = os.path.join(self.temp_markdown_dir, date_str)
        os.makedirs(date_dir, exist_ok=True)

        env = os.environ.copy()
        env["VOICETREE_MARKDOWN_DIR"] = self.temp_markdown_dir
        env["BUFFER_SIZE_THRESHOLD"] = "10"  # Low threshold for tests

        self.process = subprocess.Popen(
            ["python", "server.py"],
            cwd="/Users/bobbobby/repos/VoiceTree",
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Wait for server to start
        self._wait_for_server_ready()

    def stop(self) -> None:
        """Stop the server process."""
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()

    def _wait_for_server_ready(self, timeout: int = 30) -> None:
        """Wait for server to be ready to accept requests."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                response = requests.get(f"{self.server_url}/health", timeout=1)
                if response.status_code == 200:
                    return
            except requests.RequestException:
                pass
            time.sleep(0.1)
        raise RuntimeError(f"Server failed to start within {timeout} seconds")


@pytest.fixture
def server_manager(temp_markdown_dir):
    """Fixture to manage server lifecycle."""
    manager = ServerManager(temp_markdown_dir)
    manager.start()
    yield manager
    manager.stop()


class TestFrontendBackendIntegration:
    """Test the complete frontend-backend workflow."""

    def test_server_health_endpoint(self, server_manager: ServerManager) -> None:
        """Test that the health endpoint responds correctly."""
        response = requests.get(f"{server_manager.server_url}/health")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"

    def test_send_simple_text(self, server_manager: ServerManager, test_text_samples: Dict[str, str], temp_markdown_dir: str) -> None:
        """Test sending simple text through the API."""
        text = test_text_samples["simple"]

        # Check buffer status before
        buffer_before = requests.get(f"{server_manager.server_url}/buffer-status")
        print(f"Buffer before: {buffer_before.json()}")

        response = requests.post(
            f"{server_manager.server_url}/send-text",
            json={"text": text},
            headers={"Content-Type": "application/json"}
        )

        print(f"Response: {response.json()}")

        # Check buffer status after
        buffer_after = requests.get(f"{server_manager.server_url}/buffer-status")
        print(f"Buffer after: {buffer_after.json()}")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "success"
        assert "message" in data

        # Debug: List all files in temp dir (including date subdirectory)
        all_files = list(Path(temp_markdown_dir).rglob("*"))
        print(f"Files in temp dir (recursive): {all_files}")

        # Verify markdown files were created (look recursively for date subdirectory)
        markdown_files = list(Path(temp_markdown_dir).rglob("*.md"))
        assert len(markdown_files) > 0, f"No markdown files were created in {temp_markdown_dir}. Buffer length: {data.get('buffer_length', 'unknown')}"

    def test_send_complex_text(self, server_manager: ServerManager, test_text_samples: Dict[str, str], temp_markdown_dir: str) -> None:
        """Test sending complex text that should create multiple concepts."""
        text = test_text_samples["complex"]

        response = requests.post(
            f"{server_manager.server_url}/send-text",
            json={"text": text},
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

        # Wait a moment for processing to complete
        time.sleep(2)

        # Verify markdown files contain relevant content
        markdown_files = list(Path(temp_markdown_dir).rglob("*.md"))
        assert len(markdown_files) > 0

        # Check that at least one file contains VoiceTree-related content
        file_contents = []
        for md_file in markdown_files:
            content = md_file.read_text(encoding="utf-8")
            file_contents.append(content)

        combined_content = " ".join(file_contents).lower()
        assert any(keyword in combined_content for keyword in ["voicetree", "workflow", "text", "graph"])

    def test_invalid_request_format(self, server_manager: ServerManager) -> None:
        """Test that invalid requests are handled properly."""
        # Missing text field
        response = requests.post(
            f"{server_manager.server_url}/send-text",
            json={"invalid": "data"},
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 422  # Validation error

    def test_empty_text_request(self, server_manager: ServerManager) -> None:
        """Test sending empty text."""
        response = requests.post(
            f"{server_manager.server_url}/send-text",
            json={"text": ""},
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 400  # Bad request for empty text

    def test_multiple_requests_sequence(self, server_manager: ServerManager, test_text_samples: Dict[str, str], temp_markdown_dir: str) -> None:
        """Test sending multiple text requests in sequence."""
        texts = [
            test_text_samples["simple"],
            "This is a second message about data processing.",
            "Finally, let's discuss the results and conclusions."
        ]

        for i, text in enumerate(texts):
            response = requests.post(
                f"{server_manager.server_url}/send-text",
                json={"text": text},
                headers={"Content-Type": "application/json"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "success"

        # Verify multiple files or updated content
        time.sleep(3)  # Allow processing time
        markdown_files = list(Path(temp_markdown_dir).rglob("*.md"))
        assert len(markdown_files) > 0

        # Check that content from multiple requests is present
        all_content = ""
        for md_file in markdown_files:
            all_content += md_file.read_text(encoding="utf-8").lower()

        # Should contain content from at least some of our requests
        assert any(keyword in all_content for keyword in ["message", "processing", "results"])


# Smoke test for quick development validation
@pytest.mark.smoke
def test_dev_smoke_test(server_manager: ServerManager) -> None:
    """Quick smoke test for development iteration."""
    # Health check
    health_response = requests.get(f"{server_manager.server_url}/health")
    assert health_response.status_code == 200

    # Simple text processing
    text_response = requests.post(
        f"{server_manager.server_url}/send-text",
        json={"text": "Quick smoke test message"},
        headers={"Content-Type": "application/json"}
    )
    assert text_response.status_code == 200