#!/usr/bin/env python3
"""
Smart Development Testing Script
Intelligently selects and runs tests based on code changes and development context
"""

#todo, this is completely unnecessary complexity

import os
import sys
import subprocess
import argparse
from pathlib import Path
from typing import List, Set


def get_changed_files() -> Set[str]:
    """Get list of changed files from git"""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True,
            text=True,
            check=True
        )
        files = set(result.stdout.strip().split('\n'))
        
        # Also get staged files
        result = subprocess.run(
            ["git", "diff", "--staged", "--name-only"],
            capture_output=True,
            text=True,
            check=True
        )
        files.update(result.stdout.strip().split('\n'))
        
        return {f for f in files if f.endswith('.py')}
    except subprocess.CalledProcessError:
        return set()


def get_relevant_tests(changed_files: Set[str]) -> List[str]:
    """Determine which tests to run based on changed files"""
    test_patterns = []
    
    for file in changed_files:
        if not file or file == '':
            continue
            
        path = Path(file)
        
        # Direct test file changes
        if 'test_' in path.name:
            test_patterns.append(file)
            continue
            
        # Map source files to potential test files
        if path.suffix == '.py':
            # Backend changes -> run related tests
            if 'backend/' in file:
                if 'agentic_workflows/' in file:
                    test_patterns.extend([
                        'tests/integration_tests/agentic_workflows/',
                        'tests/unit_tests/agentic_workflows/'
                    ])
                elif 'tree_manager/' in file:
                    test_patterns.extend([
                        'tests/unit_tests/test_tree_manager*',
                        'tests/integration_tests/test_full_system*'
                    ])
                elif 'voice_to_text/' in file:
                    test_patterns.extend([
                        'tests/integration_tests/test_audio*',
                        'tests/unit_tests/test_voice*'
                    ])
                elif 'workflow_adapter' in file:
                    test_patterns.append('tests/unit_tests/test_workflow_adapter.py')
    
    return test_patterns


def run_smart_tests(speed_mode: str = "fast", changed_only: bool = False) -> int:
    """Run tests intelligently based on context"""
    
    changed_files = get_changed_files()
    print(f"🔍 Found {len(changed_files)} changed Python files")
    
    if changed_only and changed_files:
        test_patterns = get_relevant_tests(changed_files)
        if test_patterns:
            print(f"🎯 Running tests for changed files: {', '.join(test_patterns[:3])}...")
            cmd = ["python", "-m", "pytest"] + test_patterns
        else:
            print("📝 No specific tests found for changes, running smoke tests")
            cmd = ["python", "-m", "pytest", "-m", "smoke or fast"]
    else:
        # Speed-based selection
        if speed_mode == "smoke":
            print("💨 Running smoke tests (< 10s)")
            cmd = ["python", "-m", "pytest", "-m", "smoke or fast", "--tb=short", "-x", "--disable-warnings", "-q"]
        elif speed_mode == "fast":
            print("⚡ Running fast tests (< 30s)")
            cmd = ["python", "-m", "pytest", "-m", "fast or (unit and not slow)", "--tb=short", "--disable-warnings"]
        elif speed_mode == "unit":
            print("🏃 Running unit tests (< 45s)")
            cmd = ["python", "-m", "pytest", "tests/unit_tests/", "--tb=short", "--disable-warnings"]
        else:
            print("🔄 Running all tests")
            cmd = ["python", "-m", "pytest", "tests/", "--tb=short"]
    
    # Add common optimizations
    if speed_mode == "smoke":
        cmd.append("--cache-clear")
    
    cmd.append("-x" if speed_mode in ["smoke", "fast"] else "--maxfail=5")
    
    print(f"🚀 Command: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(cmd, cwd="backend")
        return result.returncode
    except KeyboardInterrupt:
        print("\n⚠️ Tests interrupted by user")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Smart development testing")
    parser.add_argument(
        "--speed", 
        choices=["smoke", "fast", "unit", "full"],
        default="fast",
        help="Test speed mode (default: fast)"
    )
    parser.add_argument(
        "--changed",
        action="store_true",
        help="Only run tests for changed files"
    )
    parser.add_argument(
        "--watch",
        action="store_true", 
        help="Watch mode - rerun on file changes"
    )
    
    args = parser.parse_args()
    
    if args.watch:
        print("👀 Starting watch mode...")
        try:
            subprocess.run([
                "ptw", 
                "--runner", f"python dev-test.py --speed {args.speed}",
                "--ignore=.git",
                "--ignore=__pycache__"
            ])
        except FileNotFoundError:
            print("❌ pytest-watch not found. Installing...")
            subprocess.run(["pip", "install", "pytest-watch"])
            subprocess.run([
                "ptw", 
                "--runner", f"python dev-test.py --speed {args.speed}",
                "--ignore=.git",
                "--ignore=__pycache__"
            ])
    else:
        return run_smart_tests(args.speed, args.changed)


if __name__ == "__main__":
    sys.exit(main()) 