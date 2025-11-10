#!/usr/bin/env python3
"""
Test script for combined-hook.py

Tests three scenarios:
1. Breaking lint change (any type) - should fail
2. Breaking test change (wrong logic) - should fail
3. Valid change - should pass

The script modifies src/utils/coordinate-conversions.ts and cleans up after itself.
"""
import subprocess
import json
import sys
import shutil
from pathlib import Path

# File paths
TARGET_FILE = Path("src/utils/coordinate-conversions.ts")
BACKUP_FILE = TARGET_FILE.with_suffix(".ts.backup")
HOOK_SCRIPT = Path(".claude/hooks/combined-hook.py")

def run_hook(file_path: str) -> tuple[int, str, str]:
    """Run the hook with the given file absolutePath and return (exit_code, stdout, stderr)"""
    hook_input = json.dumps({
        "tool_input": {
            "file_path": file_path
        }
    })

    result = subprocess.run(
        ["python3", str(HOOK_SCRIPT)],
        input=hook_input,
        text=True,
        capture_output=True,
        cwd=Path.cwd()
    )

    return result.returncode, result.stdout, result.stderr

def backup_file():
    """Create backup of the target file"""
    shutil.copy2(TARGET_FILE, BACKUP_FILE)
    print(f"✓ Backed up {TARGET_FILE} to {BACKUP_FILE}")

def restore_file():
    """Restore the target file from backup"""
    if BACKUP_FILE.exists():
        shutil.copy2(BACKUP_FILE, TARGET_FILE)
        BACKUP_FILE.unlink()
        print(f"✓ Restored {TARGET_FILE} from backup")

def test_lint_failure():
    """Test 1: Breaking lint change (any type) should fail"""
    print("\n" + "="*60)
    print("TEST 1: Breaking lint change (any type)")
    print("="*60)

    # Read original
    content = TARGET_FILE.read_text()

    # Add a function with 'any' type
    modified = content.replace(
        "export function screenToGraph(value: number, zoom: number): number {",
        "export function screenToGraph(value: any, zoom: number): number {"
    )

    # Write modified version
    TARGET_FILE.write_text(modified)
    print(f"✓ Modified {TARGET_FILE} to use 'any' type")

    # Run hook
    exit_code, stdout, stderr = run_hook(str(TARGET_FILE))

    # Verify failure
    if exit_code == 2 and "Unexpected any" in stderr:
        print("✓ Hook correctly FAILED with lint error")
        print(f"  Exit code: {exit_code}")
        return True
    else:
        print(f"✗ Hook should have failed but got exit code {exit_code}")
        print(f"  stdout: {stdout}")
        print(f"  stderr: {stderr}")
        return False

def test_test_failure():
    """Test 2: Breaking test change (wrong logic) should fail"""
    print("\n" + "="*60)
    print("TEST 2: Breaking test logic")
    print("="*60)

    # Read original
    content = TARGET_FILE.read_text()

    # Break the logic of graphToScreen - multiply by 2 instead of zoom
    modified = content.replace(
        "export function graphToScreen(value: number, zoom: number): number {\n  return value * zoom;",
        "export function graphToScreen(value: number, zoom: number): number {\n  return value * 2;"
    )

    # Write modified version
    TARGET_FILE.write_text(modified)
    print(f"✓ Modified {TARGET_FILE} to break test logic")

    # Run hook
    exit_code, stdout, stderr = run_hook(str(TARGET_FILE))

    # Verify failure
    if exit_code == 2 and ("Test failures" in stderr or "expected" in stderr.lower()):
        print("✓ Hook correctly FAILED with test failure")
        print(f"  Exit code: {exit_code}")
        return True
    else:
        print(f"✗ Hook should have failed but got exit code {exit_code}")
        print(f"  stdout: {stdout}")
        print(f"  stderr: {stderr}")
        return False

def test_valid_change():
    """Test 3: Valid change should pass"""
    print("\n" + "="*60)
    print("TEST 3: Valid change (add comment)")
    print("="*60)

    # Read original
    content = TARGET_FILE.read_text()

    # Add a harmless comment
    modified = content.replace(
        "/**\n * Scales a scalar value from screen units to graph units.",
        "/**\n * Scales a scalar value from screen units to graph units.\n * This is the inverse of graphToScreen."
    )

    # Write modified version
    TARGET_FILE.write_text(modified)
    print(f"✓ Modified {TARGET_FILE} with valid change (added comment)")

    # Run hook
    exit_code, stdout, stderr = run_hook(str(TARGET_FILE))

    # Verify success
    if exit_code == 0:
        print("✓ Hook correctly PASSED")
        print(f"  Exit code: {exit_code}")
        return True
    else:
        print(f"✗ Hook should have passed but got exit code {exit_code}")
        print(f"  stdout: {stdout}")
        print(f"  stderr: {stderr}")
        return False

def main():
    print("Testing combined-hook.py")
    print(f"Target file: {TARGET_FILE}")
    print(f"Hook script: {HOOK_SCRIPT}")

    # Verify files exist
    if not TARGET_FILE.exists():
        print(f"✗ Error: {TARGET_FILE} does not exist")
        return 1

    if not HOOK_SCRIPT.exists():
        print(f"✗ Error: {HOOK_SCRIPT} does not exist")
        return 1

    # Backup original file
    backup_file()

    try:
        # Run e2e-tests
        results = []

        # Test 1: Lint failure
        results.append(test_lint_failure())
        restore_file()
        backup_file()

        # Test 2: Test failure
        results.append(test_test_failure())
        restore_file()
        backup_file()

        # Test 3: Valid change
        results.append(test_valid_change())
        restore_file()

        # Summary
        print("\n" + "="*60)
        print("SUMMARY")
        print("="*60)
        passed = sum(results)
        total = len(results)
        print(f"Passed: {passed}/{total}")

        if all(results):
            print("\n✓ All e2e-tests PASSED")
            return 0
        else:
            print("\n✗ Some e2e-tests FAILED")
            return 1

    except Exception as e:
        print(f"\n✗ Error during testing: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        # Always restore the original file
        if BACKUP_FILE.exists():
            restore_file()
            print("\n✓ Cleanup complete")

if __name__ == "__main__":
    sys.exit(main())
