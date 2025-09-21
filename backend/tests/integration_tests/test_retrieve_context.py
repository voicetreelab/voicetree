#!/usr/bin/env python3
"""
Behavioral test for retrieve_context.py end-to-end flow.
Tests the complete pipeline from markdown loading to context output.
"""

import os
import sys
import tempfile
import shutil
from pathlib import Path
import subprocess

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from backend.context_retrieval.retrieve_context import retrieve_context


def create_test_markdown_tree(test_dir: Path):
    """Create a simple test markdown tree structure."""
    # Create root node
    root_content = """---
node_id: 1
title: Root Node - Authentication System
---
## Overview
This is the root node describing the authentication system architecture.
"""
    (test_dir / "1_Root_Node_Authentication_System.md").write_text(root_content)

    # Create child node 1
    child1_content = """---
node_id: 2
title: Login Module
---
## Login Implementation
The login module handles user authentication via OAuth2.
Uses JWT tokens for session management.

Parent: [[1_Root_Node_Authentication_System.md]]
"""
    (test_dir / "2_Login_Module.md").write_text(child1_content)

    # Create child node 2
    child2_content = """---
node_id: 3
title: Password Hashing
---
## Security Implementation
Implements bcrypt for secure password hashing.
Salt rounds: 12 for production environment.

Parent: [[1_Root_Node_Authentication_System.md]]
"""
    (test_dir / "3_Password_Hashing.md").write_text(child2_content)

    # Create sibling/neighbor node
    neighbor_content = """---
node_id: 4
title: Session Management
---
## Session Handling
Manages user sessions with Redis backend.
TTL: 24 hours for standard sessions.

Related: [[2_Login_Module.md]]
"""
    (test_dir / "4_Session_Management.md").write_text(neighbor_content)

    # Create unrelated node
    unrelated_content = """---
node_id: 5
title: Unrelated Feature
---
## Different Component
This is about a completely different feature not related to authentication.
"""
    (test_dir / "5_Unrelated_Feature.md").write_text(unrelated_content)


def test_retrieve_context_behavioral():
    """Test the complete retrieve_context flow."""
    # Create temporary directory with test markdown tree
    with tempfile.TemporaryDirectory() as temp_dir:
        test_dir = Path(temp_dir)
        create_test_markdown_tree(test_dir)

        print("="*60)
        print("BEHAVIORAL TEST: retrieve_context.py")
        print("="*60)

        # Test 1: Query about authentication
        print("\n[Test 1] Query: 'OAuth2 JWT authentication'")
        try:
            context = retrieve_context(str(test_dir), "OAuth2 JWT authentication")
            assert context, "Should return context for authentication query"
            assert "Login Module" in context or "Login Implementation" in context, "Should find login module"
            assert "OAuth2" in context or "JWT" in context, "Should include relevant content"
            print("✓ Authentication query returned relevant context")
        except Exception as e:
            print(f"✗ Failed: {e}")
            return False

        # Test 2: Query about security
        print("\n[Test 2] Query: 'password security hashing'")
        try:
            context = retrieve_context(str(test_dir), "password security hashing")
            assert context, "Should return context for security query"
            assert "bcrypt" in context or "Password Hashing" in context, "Should find password hashing module"
            print("✓ Security query returned relevant context")
        except Exception as e:
            print(f"✗ Failed: {e}")
            return False

        # Test 3: Command-line interface test
        print("\n[Test 3] Command-line interface test")
        try:
            script_path = Path(__file__).parent.parent.parent / "context_retrieval" / "retrieve_context.py"
            result = subprocess.run(
                [sys.executable, str(script_path), str(test_dir), "authentication system"],
                capture_output=True,
                text=True,
                timeout=30
            )

            assert result.returncode == 0, f"Script should exit successfully, got code {result.returncode}"
            assert "=== CONTEXT OUTPUT ===" in result.stdout, "Should have start marker"
            assert "=== END CONTEXT ===" in result.stdout, "Should have end marker"

            # Check that some content is between markers
            output_lines = result.stdout.split("\n")
            start_idx = None
            end_idx = None
            for i, line in enumerate(output_lines):
                if "=== CONTEXT OUTPUT ===" in line:
                    start_idx = i
                if "=== END CONTEXT ===" in line:
                    end_idx = i

            assert start_idx is not None and end_idx is not None, "Should find both markers"
            assert end_idx > start_idx + 1, "Should have content between markers"
            print("✓ Command-line interface works correctly")
        except subprocess.TimeoutExpired:
            print("✗ Script timed out")
            return False
        except Exception as e:
            print(f"✗ Failed: {e}")
            return False

        # Test 4: Error handling - non-existent directory
        print("\n[Test 4] Error handling test")
        try:
            result = subprocess.run(
                [sys.executable, str(script_path), "/non/existent/directory", "test query"],
                capture_output=True,
                text=True,
                timeout=10
            )
            assert result.returncode != 0, "Should exit with error for non-existent directory"
            assert "Error" in result.stderr or "not found" in result.stderr, "Should output error message"
            print("✓ Error handling works correctly")
        except Exception as e:
            print(f"✗ Failed: {e}")
            return False

        print("\n" + "="*60)
        print("ALL TESTS PASSED ✓")
        print("="*60)
        return True


if __name__ == "__main__":
    success = test_retrieve_context_behavioral()
    sys.exit(0 if success else 1)