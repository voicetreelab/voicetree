import os
import shutil
import tempfile
import asyncio
import subprocess
import time
import requests
import pytest
from contextlib import asynccontextmanager

# Note: This test uses HTTP requests to test the server, so no async nesting needed


class TestServerSystem:
    @pytest.fixture(autouse=True)
    def setup_method(self, tmp_path):
        """Set up test environment with temporary directories and server process"""
        # Use pytest's tmp_path for test output
        self.test_output_dir = str(tmp_path / "test_server_output")
        self.server_process = None
        self.server_port = 8001  # Use different port to avoid conflicts
        self.server_url = f"http://localhost:{self.server_port}"

        # Set environment variables for server
        os.environ["VOICETREE_MARKDOWN_DIR"] = self.test_output_dir
        os.environ["VOICETREE_PORT"] = str(self.server_port)

        # Create test output directory
        os.makedirs(self.test_output_dir, exist_ok=True)

        # Clear any existing log files
        log_file_path = "voicetree.log"
        if os.path.exists(log_file_path):
            with open(log_file_path, 'w') as f:
                f.truncate()

        yield

        # Cleanup after test
        self._stop_server()
        # Clean up test environment variables
        if "VOICETREE_MARKDOWN_DIR" in os.environ:
            del os.environ["VOICETREE_MARKDOWN_DIR"]
        if "VOICETREE_PORT" in os.environ:
            del os.environ["VOICETREE_PORT"]
        # Clean up test output directory
        shutil.rmtree(self.test_output_dir, ignore_errors=True)

    def _start_server(self):
        """Start the VoiceTree server in a subprocess"""
        import subprocess
        import sys

        # Start server process
        server_script = os.path.join(os.getcwd(), "server.py")
        if not os.path.exists(server_script):
            pytest.skip(f"Server script not found at {server_script}")

        # Start server with custom port
        self.server_process = subprocess.Popen([
            sys.executable, server_script
        ], env={
            **os.environ,
            "VOICETREE_MARKDOWN_DIR": self.test_output_dir,
            "VOICETREE_PORT": str(self.server_port)
        }, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Wait for server to start (max 10 seconds)
        for i in range(20):
            try:
                response = requests.get(f"{self.server_url}/health", timeout=1)
                if response.status_code == 200:
                    print(f"✅ Server started successfully on port {self.server_port}")
                    return True
            except requests.exceptions.RequestException:
                pass
            time.sleep(0.5)

        # If we get here, server didn't start
        stdout, stderr = self.server_process.communicate(timeout=1)
        print(f"❌ Server failed to start")
        print(f"stdout: {stdout.decode()}")
        print(f"stderr: {stderr.decode()}")
        pytest.fail("Server failed to start within 10 seconds")

    def _stop_server(self):
        """Stop the server process"""
        if self.server_process:
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=5)
                print("✅ Server stopped successfully")
            except subprocess.TimeoutExpired:
                self.server_process.kill()
                self.server_process.wait()
                print("⚠️ Server forcibly killed")
            self.server_process = None

    def _send_text_to_server(self, text: str) -> dict:
        """Send text to the server's /send-text endpoint"""
        try:
            response = requests.post(
                f"{self.server_url}/send-text",
                json={"text": text},
                timeout=30  # LLM processing can take time
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            pytest.fail(f"Failed to send text to server: {e}")

    def _get_health_status(self) -> dict:
        """Get server health status"""
        try:
            response = requests.get(f"{self.server_url}/health", timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            pytest.fail(f"Failed to get health status: {e}")

    def _get_buffer_status(self) -> dict:
        """Get server buffer status"""
        try:
            response = requests.get(f"{self.server_url}/buffer-status", timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            pytest.fail(f"Failed to get buffer status: {e}")

    def test_server_startup_and_health(self):
        """Test that the server starts up correctly and responds to health checks"""
        print("\n🧪 Testing server startup and health check...")

        self._start_server()

        # Test health endpoint
        health_response = self._get_health_status()
        print(f"📊 Health response: {health_response}")

        assert "status" in health_response
        assert health_response["status"] == "healthy"
        assert "nodes" in health_response
        assert isinstance(health_response["nodes"], int)

        print("✅ Server health check passed")

    def test_server_text_processing_single_chunk(self):
        """Test that the server can process a single text chunk end-to-end"""
        print("\n🧪 Testing single text chunk processing...")

        self._start_server()

        # Test text that should create a meaningful node
        test_text = (
            "I'm working on a new artificial intelligence project. "
            "The project involves building a machine learning model for text analysis. "
            "We need to implement natural language processing capabilities."
        )

        print(f"📝 Sending text: {test_text[:50]}...")

        # Send text to server
        response = self._send_text_to_server(test_text)
        print(f"📨 Server response: {response}")

        # Verify response structure
        assert response["status"] == "success"
        assert "message" in response
        assert "buffer_length" in response

        # Check health status after processing
        health_response = self._get_health_status()
        print(f"📊 Health after processing: {health_response}")

        # Should have created at least one node
        assert health_response["nodes"] >= 1, "Should have created at least one node"

        # Check that markdown files were created
        markdown_files = [f for f in os.listdir(self.test_output_dir) if f.endswith('.md')]
        print(f"📁 Markdown files created: {len(markdown_files)}")
        assert len(markdown_files) >= 1, "Should have created at least one markdown file"

        # Verify file content contains relevant information
        first_file_path = os.path.join(self.test_output_dir, markdown_files[0])
        with open(first_file_path, 'r') as f:
            content = f.read()
            print(f"📄 First file content preview: {content[:200]}...")

            # Content should not be empty
            assert len(content) > 0, "Markdown file should not be empty"

            # Content should contain some words from the input
            test_words = set(test_text.lower().split())
            content_words = set(content.lower().split())
            common_words = test_words & content_words

            # Remove common stop words
            stop_words = {'the', 'a', 'an', 'is', 'it', 'to', 'and', 'or', 'of', 'in', 'on', 'i'}
            meaningful_common_words = common_words - stop_words
            meaningful_test_words = test_words - stop_words

            if meaningful_test_words:
                percentage = len(meaningful_common_words) / len(meaningful_test_words) * 100
                print(f"📊 Content contains {percentage:.1f}% of meaningful input words")
                assert percentage >= 10, f"Content should contain at least 10% of input words, but only contains {percentage:.1f}%"

        print("✅ Single text chunk processing test passed")

    def test_server_text_processing_multiple_chunks(self):
        """Test that the server can process multiple text chunks sequentially"""
        print("\n🧪 Testing multiple text chunk processing...")

        self._start_server()

        # Test chunks that build on each other
        chunks = [
            "I'm starting a new software development project focused on web applications.",
            "The project will use React for the frontend and Node.js for the backend services.",
            "We need to implement user authentication, data persistence, and real-time features."
        ]

        initial_health = self._get_health_status()
        initial_nodes = initial_health["nodes"]
        print(f"📊 Initial nodes: {initial_nodes}")

        # Process each chunk sequentially
        for i, chunk in enumerate(chunks):
            print(f"📝 Processing chunk {i+1}: {chunk[:50]}...")

            response = self._send_text_to_server(chunk)
            assert response["status"] == "success"

            # Check buffer status
            buffer_status = self._get_buffer_status()
            print(f"📊 Buffer length after chunk {i+1}: {buffer_status['buffer_length']}")

            # Small delay between chunks to avoid overwhelming the system
            time.sleep(1)

        # Check final health status
        final_health = self._get_health_status()
        final_nodes = final_health["nodes"]
        print(f"📊 Final nodes: {final_nodes}")

        # Should have created new nodes
        nodes_created = final_nodes - initial_nodes
        print(f"📊 Nodes created: {nodes_created}")
        assert nodes_created >= 1, f"Should have created at least 1 node, but created {nodes_created}"

        # Check markdown files
        markdown_files = [f for f in os.listdir(self.test_output_dir) if f.endswith('.md')]
        print(f"📁 Total markdown files: {len(markdown_files)}")
        assert len(markdown_files) >= 1, "Should have created at least one markdown file"

        # Verify content quality across files
        all_content = ""
        for filename in markdown_files:
            with open(os.path.join(self.test_output_dir, filename), 'r') as f:
                all_content += f.read() + " "

        # Check that content from different chunks appears in the files
        chunk_terms = [
            ["software development", "web applications"],
            ["React", "Node.js", "frontend", "backend"],
            ["authentication", "persistence", "real-time"]
        ]

        chunks_represented = 0
        for terms in chunk_terms:
            if any(term.lower() in all_content.lower() for term in terms):
                chunks_represented += 1

        print(f"📊 Chunks represented in content: {chunks_represented}/{len(chunks)}")
        assert chunks_represented >= 2, f"Content from at least 2 chunks should appear in files, but only {chunks_represented} chunks represented"

        print("✅ Multiple text chunk processing test passed")

    def test_server_error_handling(self):
        """Test that the server handles invalid requests appropriately"""
        print("\n🧪 Testing server error handling...")

        self._start_server()

        # Test empty text
        print("📝 Testing empty text handling...")
        response = requests.post(
            f"{self.server_url}/send-text",
            json={"text": ""},
            timeout=5
        )
        assert response.status_code == 400, "Empty text should return 400 error"

        # Test whitespace-only text
        print("📝 Testing whitespace-only text handling...")
        response = requests.post(
            f"{self.server_url}/send-text",
            json={"text": "   \n\t  "},
            timeout=5
        )
        assert response.status_code == 400, "Whitespace-only text should return 400 error"

        # Test invalid JSON
        print("📝 Testing invalid JSON handling...")
        response = requests.post(
            f"{self.server_url}/send-text",
            data="invalid json",
            headers={"Content-Type": "application/json"},
            timeout=5
        )
        assert response.status_code == 422, "Invalid JSON should return 422 error"

        # Test missing text field
        print("📝 Testing missing text field handling...")
        response = requests.post(
            f"{self.server_url}/send-text",
            json={"not_text": "some content"},
            timeout=5
        )
        assert response.status_code == 422, "Missing text field should return 422 error"

        print("✅ Server error handling test passed")

    def test_server_concurrent_requests(self):
        """Test that the server can handle multiple concurrent requests"""
        print("\n🧪 Testing concurrent request handling...")

        self._start_server()

        # Prepare concurrent requests
        test_texts = [
            "First concurrent request about machine learning algorithms and neural networks.",
            "Second concurrent request about web development frameworks and database design.",
            "Third concurrent request about mobile application development and user interface design."
        ]

        import threading
        import queue

        results = queue.Queue()

        def send_request(text, request_id):
            try:
                print(f"📝 Sending concurrent request {request_id}...")
                response = self._send_text_to_server(text)
                results.put((request_id, "success", response))
            except Exception as e:
                results.put((request_id, "error", str(e)))

        # Start concurrent requests
        threads = []
        for i, text in enumerate(test_texts):
            thread = threading.Thread(target=send_request, args=(text, i+1))
            threads.append(thread)
            thread.start()

        # Wait for all requests to complete
        for thread in threads:
            thread.join(timeout=60)  # Give plenty of time for LLM processing

        # Check results
        successful_requests = 0
        failed_requests = 0

        while not results.empty():
            request_id, status, response = results.get()
            if status == "success":
                successful_requests += 1
                print(f"✅ Request {request_id} succeeded")
                assert response["status"] == "success"
            else:
                failed_requests += 1
                print(f"❌ Request {request_id} failed: {response}")

        print(f"📊 Concurrent request results: {successful_requests} successful, {failed_requests} failed")

        # At least 2 out of 3 requests should succeed (allowing for some LLM variability)
        assert successful_requests >= 2, f"At least 2 concurrent requests should succeed, but only {successful_requests} succeeded"

        # Check final state
        final_health = self._get_health_status()
        print(f"📊 Final health after concurrent requests: {final_health}")

        # Should have created nodes from successful requests
        assert final_health["nodes"] >= 1, "Should have created at least one node from concurrent requests"

        print("✅ Concurrent request handling test passed")

    def test_server_buffer_management(self):
        """Test that the server properly manages text buffers"""
        print("\n🧪 Testing server buffer management...")

        self._start_server()

        # Check initial buffer status
        initial_buffer = self._get_buffer_status()
        print(f"📊 Initial buffer status: {initial_buffer}")
        assert initial_buffer["buffer_length"] == 0, "Initial buffer should be empty"

        # Send text that might not immediately trigger processing
        short_text = "Short text input for buffer testing."
        print(f"📝 Sending short text: {short_text}")

        response = self._send_text_to_server(short_text)
        assert response["status"] == "success"

        # Check buffer status after short text
        buffer_after_short = self._get_buffer_status()
        print(f"📊 Buffer after short text: {buffer_after_short}")

        # Send longer text that should trigger processing
        long_text = (
            "This is a much longer text input that should definitely trigger buffer processing. "
            "It contains multiple sentences with various topics including artificial intelligence, "
            "machine learning, software development, and data science. The purpose is to ensure "
            "that the buffer management system works correctly and processes text when appropriate "
            "thresholds are reached, maintaining the integrity of the text processing pipeline."
        )
        print(f"📝 Sending long text ({len(long_text)} chars)...")

        response = self._send_text_to_server(long_text)
        assert response["status"] == "success"

        # Check buffer status after long text
        buffer_after_long = self._get_buffer_status()
        print(f"📊 Buffer after long text: {buffer_after_long}")

        # Check that processing occurred (nodes were created)
        final_health = self._get_health_status()
        print(f"📊 Final health status: {final_health}")

        assert final_health["nodes"] >= 1, "Should have created at least one node from buffer processing"

        print("✅ Server buffer management test passed")