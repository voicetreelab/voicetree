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
    def setup_method(self):
        """Set up test environment with temporary directories and server process"""
        # Use hardcoded test vault (absolute path)
        self.test_output_dir = os.path.abspath("backend/tests/system_test/testVault")
        self.server_process = None
        self.server_port = 8002  # Use different port to avoid conflicts
        self.server_url = f"http://localhost:{self.server_port}"
        self.server_stdout_file = None
        self.server_stderr_file = None

        # Clean and create test output directory
        shutil.rmtree(self.test_output_dir, ignore_errors=True)
        os.makedirs(self.test_output_dir, exist_ok=True)

        # Set environment variables for server (after creating directory)
        os.environ["VOICETREE_MARKDOWN_DIR"] = self.test_output_dir
        os.environ["VOICETREE_PORT"] = str(self.server_port)

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
        # Clean up server log files
        self._cleanup_log_files()

    def _start_server(self):
        """Start the VoiceTree server in a subprocess"""
        import subprocess
        import sys

        # Start server process from project root
        # Get project root (3 levels up from this test file)
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        server_script = os.path.join(project_root, "server.py")
        if not os.path.exists(server_script):
            pytest.skip(f"Server script not found at {server_script}")

        # Create log files for server output
        self.server_stdout_file = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='_server_stdout.log')
        self.server_stderr_file = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='_server_stderr.log')

        # Start server with custom port, redirect output to files
        self.server_process = subprocess.Popen([
            sys.executable, server_script
        ], env={
            **os.environ,
            "VOICETREE_MARKDOWN_DIR": self.test_output_dir,
            "VOICETREE_PORT": str(self.server_port)
        }, stdout=self.server_stdout_file, stderr=self.server_stderr_file)

        # Wait for server to start (max 10 seconds)
        for i in range(20):
            try:
                response = requests.get(f"{self.server_url}/health", timeout=1)
                if response.status_code == 200:
                    print(f"✅ Server started successfully on port {self.server_port}")

                    # Explicitly load the test directory to ensure server uses correct tree
                    load_response = self._load_directory(self.test_output_dir)
                    print(f"✅ Server loaded directory: {load_response}")

                    return True
            except requests.exceptions.RequestException:
                pass
            time.sleep(0.5)

        # If we get here, server didn't start - print the logs
        print(f"❌ Server failed to start within 10 seconds")
        self._print_server_logs()
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

    def _print_server_logs(self):
        """Print server stdout and stderr logs"""
        if self.server_stdout_file:
            self.server_stdout_file.flush()
            self.server_stdout_file.seek(0)
            stdout_content = self.server_stdout_file.read()
            if stdout_content:
                print("\n" + "="*80)
                print("SERVER STDOUT:")
                print("="*80)
                print(stdout_content)
                print("="*80 + "\n")

        if self.server_stderr_file:
            self.server_stderr_file.flush()
            self.server_stderr_file.seek(0)
            stderr_content = self.server_stderr_file.read()
            if stderr_content:
                print("\n" + "="*80)
                print("SERVER STDERR:")
                print("="*80)
                print(stderr_content)
                print("="*80 + "\n")

    def _cleanup_log_files(self):
        """Clean up temporary log files"""
        if self.server_stdout_file:
            try:
                self.server_stdout_file.close()
                os.unlink(self.server_stdout_file.name)
            except Exception:
                pass
            self.server_stdout_file = None

        if self.server_stderr_file:
            try:
                self.server_stderr_file.close()
                os.unlink(self.server_stderr_file.name)
            except Exception:
                pass
            self.server_stderr_file = None

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

    def _load_directory(self, directory_path: str) -> dict:
        """Tell server to load a specific directory"""
        try:
            response = requests.post(
                f"{self.server_url}/load-directory",
                json={"directory_path": directory_path},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"\n❌ Failed to load directory: {e}")
            self._print_server_logs()
            pytest.fail(f"Failed to load directory: {e}")

    def _wait_for_processing_complete(self, timeout: int = 60, expect_nodes: bool = True) -> bool:
        """
        Wait for background processing to complete by polling health endpoint.
        Processing is considered complete when node count is stable for multiple checks.

        Note: We cannot rely on buffer status because the server clears the buffer
        immediately when processing starts, not when it completes.

        Args:
            timeout: Maximum time to wait in seconds
            expect_nodes: If True, wait for at least one node to be created

        Returns:
            True if processing completed successfully, False if timeout
        """
        start_time = time.time()
        last_node_count = -1
        stable_count = 0
        required_stable_checks = 6  # Need 3 seconds of stability (6 * 0.5s)

        while time.time() - start_time < timeout:
            try:
                # Check node count
                health_status = self._get_health_status()
                node_count = health_status["nodes"]

                # If we expect nodes and node count is stable at > 0, we're done
                # If we don't expect nodes (or they failed to create), wait for stability at 0
                if node_count == last_node_count:
                    stable_count += 1
                    print(f"🔄 Node count stable at {node_count} ({stable_count}/{required_stable_checks} checks)")

                    # If expecting nodes, need at least 1 node created
                    if expect_nodes and node_count >= 1 and stable_count >= required_stable_checks:
                        print(f"✅ Processing complete: {node_count} nodes created")
                        return True
                    # If not expecting nodes, just wait for stability
                    elif not expect_nodes and stable_count >= required_stable_checks:
                        print(f"✅ Processing stable: {node_count} nodes")
                        return True
                else:
                    # Node count changed, reset stability counter
                    if stable_count > 0:
                        print(f"🔄 Node count changed: {last_node_count} → {node_count}")
                    stable_count = 0

                last_node_count = node_count
                time.sleep(0.5)

            except Exception as e:
                print(f"⚠️ Error while waiting for processing: {e}")
                time.sleep(0.5)

        print(f"⚠️ Timeout waiting for processing to complete after {timeout}s")
        print(f"   Final node count: {last_node_count}, stable checks: {stable_count}/{required_stable_checks}")
        return False

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

        # Count markdown files before processing
        initial_markdown_files = [f for f in os.listdir(self.test_output_dir) if f.endswith('.md')]
        initial_file_count = len(initial_markdown_files)
        print(f"📁 Initial markdown files: {initial_file_count}")

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

        # Wait for background processing to complete
        print("⏳ Waiting for background processing to complete...")
        processing_success = self._wait_for_processing_complete(timeout=60)
        assert processing_success, "Processing should complete within timeout"

        # Check health status after processing
        health_response = self._get_health_status()
        print(f"📊 Health after processing: {health_response}")

        # Should have created at least one node
        assert health_response["nodes"] >= 1, "Should have created at least one node"

        # Check that markdown files were created
        final_markdown_files = [f for f in os.listdir(self.test_output_dir) if f.endswith('.md')]
        final_file_count = len(final_markdown_files)
        files_created = final_file_count - initial_file_count
        print(f"📁 Markdown files: {initial_file_count} → {final_file_count} (+{files_created})")
        assert files_created >= 1, f"Should have created at least 1 markdown file, but created {files_created}"

        # Verify file content contains relevant information
        first_file_path = os.path.join(self.test_output_dir, final_markdown_files[0])
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

        # Count markdown files before processing
        initial_markdown_files = [f for f in os.listdir(self.test_output_dir) if f.endswith('.md')]
        initial_file_count = len(initial_markdown_files)
        print(f"📁 Initial markdown files: {initial_file_count}")

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

        # Wait for all background processing to complete
        print("⏳ Waiting for all background processing to complete...")
        processing_success = self._wait_for_processing_complete(timeout=60)
        assert processing_success, "Processing should complete within timeout"

        # Check final health status
        final_health = self._get_health_status()
        final_nodes = final_health["nodes"]
        print(f"📊 Final nodes: {final_nodes}")

        # Should have created new nodes
        nodes_created = final_nodes - initial_nodes
        print(f"📊 Nodes created: {nodes_created}")
        assert nodes_created >= 1, f"Should have created at least 1 node, but created {nodes_created}"

        # Check markdown files
        final_markdown_files = [f for f in os.listdir(self.test_output_dir) if f.endswith('.md')]
        final_file_count = len(final_markdown_files)
        files_created = final_file_count - initial_file_count
        print(f"📁 Markdown files: {initial_file_count} → {final_file_count} (+{files_created})")
        assert files_created >= 1, f"Should have created at least 1 markdown file, but created {files_created}"

        # Verify content quality across files
        all_content = ""
        for filename in final_markdown_files:
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

        # Wait for all background processing to complete
        print("⏳ Waiting for all background processing to complete...")
        processing_success = self._wait_for_processing_complete(timeout=60)
        assert processing_success, "Processing should complete within timeout"

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

        # Wait for background processing to complete
        print("⏳ Waiting for background processing to complete...")
        processing_success = self._wait_for_processing_complete(timeout=60)
        assert processing_success, "Processing should complete within timeout"

        # Check that processing occurred (nodes were created)
        final_health = self._get_health_status()
        print(f"📊 Final health status: {final_health}")

        assert final_health["nodes"] >= 1, "Should have created at least one node from buffer processing"

        print("✅ Server buffer management test passed")