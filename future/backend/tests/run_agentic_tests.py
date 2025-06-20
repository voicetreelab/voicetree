#!/usr/bin/env python3
"""
Test runner for agentic workflow tests
"""

import subprocess
import sys
from pathlib import Path


def run_tests():
    """Run all agentic workflow tests"""
    
    print("🚀 Running VoiceTree Agentic Workflow Tests")
    print("=" * 60)
    
    # Change to project root
    project_root = Path(__file__).parent.parent.parent
    
    test_commands = [
        {
            "name": "Unit Tests - Prompt Engine",
            "cmd": ["python", "-m", "pytest", "backend/tests/unit_tests/agentic_workflows/", "-v"],
            "description": "Fast unit tests for individual components"
        },
        {
            "name": "Integration Tests - Pipeline",
            "cmd": ["python", "-m", "pytest", "backend/tests/integration_tests/agentic_workflows/", "-v"],
            "description": "Integration tests for the full pipeline"
        },
        {
            "name": "Reproduction Issues Tests",
            "cmd": ["python", "-m", "pytest", "backend/tests/integration_tests/test_reproduction_issues.py", "-v"],
            "description": "Tests for previously identified issues"
        }
    ]
    
    passed = 0
    failed = 0
    
    for test_config in test_commands:
        print(f"\n{'='*60}")
        print(f"🧪 {test_config['name']}")
        print(f"📝 {test_config['description']}")
        print(f"{'='*60}")
        
        try:
            result = subprocess.run(
                test_config["cmd"],
                cwd=project_root,
                capture_output=False,
                check=False
            )
            
            if result.returncode == 0:
                print(f"✅ {test_config['name']} - PASSED")
                passed += 1
            else:
                print(f"❌ {test_config['name']} - FAILED (exit code: {result.returncode})")
                failed += 1
                
        except Exception as e:
            print(f"❌ {test_config['name']} - ERROR: {e}")
            failed += 1
    
    print(f"\n{'='*60}")
    print(f"📊 Test Summary:")
    print(f"   ✅ Passed: {passed}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📈 Total: {passed + failed}")
    
    if failed == 0:
        print("\n🎉 All agentic workflow tests passed!")
        return 0
    else:
        print(f"\n⚠️  {failed} test suite(s) failed")
        return 1


if __name__ == "__main__":
    exit_code = run_tests()
    sys.exit(exit_code) 