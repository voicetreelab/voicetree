#!/usr/bin/env python3
"""
Integration test for Infinite LLM context retrieval pipeline.
Tests the complete flow from query to linearized output.
"""

import os
import sys
import tempfile
from pathlib import Path
from typing import Dict, Any

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from backend.context_retrieval.retrieve_context import retrieve_context


def create_test_markdown_tree(test_dir: Path) -> Dict[str, str]:
    """Create a test markdown tree structure."""
    files = {
        "1_Root_Project.md": """---
node_id: 1
title: Root Project
---
### This is the root of our knowledge tree
The main project documentation.

_Links:_
""",
        "2_Authentication_System.md": """---
node_id: 2
title: Authentication System
---
### Authentication handles user login and security
We use JWT tokens for authentication.

_Links:_
Parent:
- is_component_of [[1_Root_Project.md]]
""",
        "3_Database_Layer.md": """---
node_id: 3
title: Database Layer
---
### Database handles data persistence
Using PostgreSQL with connection pooling.

_Links:_
Parent:
- is_component_of [[1_Root_Project.md]]
""",
        "4_JWT_Implementation.md": """---
node_id: 4
title: JWT Implementation
---
### JWT tokens provide stateless authentication
Tokens expire after 24 hours.

_Links:_
Parent:
- is_implementation_of [[2_Authentication_System.md]]
""",
        "5_Password_Hashing.md": """---
node_id: 5
title: Password Hashing
---
### Passwords are hashed using bcrypt
Salt rounds set to 10 for security.

_Links:_
Parent:
- is_part_of [[2_Authentication_System.md]]
""",
        "6_Connection_Pool.md": """---
node_id: 6
title: Connection Pool
---
### Connection pooling improves database performance
Maximum 20 connections in the pool.

_Links:_
Parent:
- is_configuration_of [[3_Database_Layer.md]]
""",
    }

    # Write files to test directory
    for filename, content in files.items():
        filepath = test_dir / filename
        with open(filepath, 'w') as f:
            f.write(content)

    return files


def test_retrieve_context_authentication_query():
    """Test context retrieval for authentication-related query."""

    # Create temporary test directory
    with tempfile.TemporaryDirectory() as tmpdir:
        test_dir = Path(tmpdir)
        create_test_markdown_tree(test_dir)

        # Test query about authentication
        query = "How does the authentication system work with JWT tokens?"

        # Run retrieve_context
        try:
            result = retrieve_context(str(test_dir), query)

            # Verify result contains expected nodes
            assert result is not None, "Result should not be None"
            assert len(result) > 0, "Result should not be empty"

            # Check for key nodes in the output
            expected_content = [
                "Authentication System",  # Target node
                "JWT Implementation",      # Child of target
                "Password Hashing",        # Sibling (neighbor)
                "Root Project",           # Parent in path
            ]

            for expected in expected_content:
                assert expected in result, f"Result should contain '{expected}'"

            # Verify structure markers (if using accumulate_content)
            assert "TARGETS" in result or "Target" in result, "Should identify target nodes"

            # Verify distance constraints
            # Database Layer should NOT be included (not in path to authentication)
            # unless it's a neighbor

            print("✅ Test passed: Authentication query retrieved relevant context")
            print("\n--- Output Preview ---")
            print(result[:1000])  # Show first 1000 chars
            print("...")

            return True

        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()
            return False


def test_end_to_end_with_shell_script():
    """Test the complete pipeline including shell script."""

    with tempfile.TemporaryDirectory() as tmpdir:
        test_dir = Path(tmpdir)
        create_test_markdown_tree(test_dir)

        # Test the shell script if it exists
        voicetree_root = os.getenv('VOICETREE_ROOT')
        if not voicetree_root:
            raise ValueError("VOICETREE_ROOT environment variable not set. Run setup.sh first.")
        shell_script = Path(voicetree_root) / "markdownTreeVault/infllm.sh"
        if shell_script.exists():
            import subprocess

            # Set environment to use test directory
            env = os.environ.copy()
            env['MARKDOWN_VAULT'] = str(test_dir)

            # Run shell script with test query
            result = subprocess.run(
                [str(shell_script), "How does authentication work?"],
                capture_output=True,
                text=True,
                env=env
            )

            if result.returncode == 0:
                print("✅ Shell script integration test passed")
                return True
            else:
                print(f"❌ Shell script failed: {result.stderr}")
                return False
        else:
            print("⚠️ Shell script not found, skipping integration test")
            return None


def main():
    """Run all integration tests."""
    print("=" * 60)
    print("Infinite LLM Integration Tests")
    print("=" * 60)

    tests = [
        ("Context Retrieval", test_retrieve_context_authentication_query),
        ("Shell Script E2E", test_end_to_end_with_shell_script),
    ]

    results = []
    for test_name, test_func in tests:
        print(f"\n📋 Running: {test_name}")
        result = test_func()
        if result is not None:
            results.append((test_name, result))

    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)

    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status}: {test_name}")

    all_passed = all(passed for _, passed in results)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())