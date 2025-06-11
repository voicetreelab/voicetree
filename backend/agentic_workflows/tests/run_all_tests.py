#!/usr/bin/env python3
"""
Run all VoiceTree LangGraph tests
"""

import subprocess
import sys
from pathlib import Path

def run_test(test_file: str, description: str):
    """Run a single test file"""
    print(f"\n{'='*60}")
    print(f"🧪 {description}")
    print(f"{'='*60}")
    
    result = subprocess.run([sys.executable, test_file], capture_output=False)
    
    if result.returncode == 0:
        print(f"✅ {test_file} passed")
    else:
        print(f"❌ {test_file} failed with code {result.returncode}")
    
    return result.returncode == 0

def main():
    """Run all tests"""
    print("🚀 Running VoiceTree LangGraph Test Suite")
    
    tests = [
        ("test_state_persistence.py", "Testing State Persistence"),
        ("test_chunk_boundaries.py", "Testing Chunk Boundary Handling"),
        ("test_pipeline.py", "Testing Basic Pipeline Functionality"),
        ("test_real_examples.py", "Testing Real-World Examples"),
    ]
    
    passed = 0
    failed = 0
    
    for test_file, description in tests:
        if run_test(test_file, description):
            passed += 1
        else:
            failed += 1
    
    print(f"\n{'='*60}")
    print(f"📊 Test Summary:")
    print(f"   ✅ Passed: {passed}")
    print(f"   ❌ Failed: {failed}")
    print(f"   📈 Total: {passed + failed}")
    
    if failed == 0:
        print("\n🎉 All tests passed!")
    else:
        print(f"\n⚠️  {failed} test(s) failed")
        sys.exit(1)

if __name__ == "__main__":
    main() 