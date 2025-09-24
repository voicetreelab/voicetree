#!/usr/bin/env python3
"""
Simple integration test for VoiceTree frontend-backend connection.
Tests that the /send-text endpoint properly processes text through the VoiceTree pipeline.
"""

import requests
import json
import time
import os
from pathlib import Path

def test_server_health():
    """Test that the VoiceTree server is running and healthy."""
    try:
        response = requests.get("http://localhost:8000/health")
        if response.status_code == 200:
            print("✅ Server is healthy")
            print(f"   Response: {response.json()}")
            return True
        else:
            print(f"❌ Server health check failed: {response.status_code}")
            return False
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to server at localhost:8000")
        print("   Make sure to run: python server.py")
        return False

def test_send_text_endpoint():
    """Test sending text to the VoiceTree server."""
    test_text = "This is a simple test message for the VoiceTree integration. The system should process this text and create appropriate markdown nodes in the tree structure."

    try:
        response = requests.post(
            "http://localhost:8000/send-text",
            headers={"Content-Type": "application/json"},
            json={"text": test_text}
        )

        if response.status_code == 200:
            result = response.json()
            print("✅ Text sent successfully")
            print(f"   Response: {result}")
            return True
        else:
            print(f"❌ Failed to send text: {response.status_code}")
            print(f"   Response: {response.text}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return False

def check_markdown_tree_update():
    """Check if new markdown files were created in the tree."""
    vault_path = Path("/Users/bobbobby/repos/VoiceTree/markdownTreeVault")

    # Get current date folder
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    today_path = vault_path / today

    if today_path.exists():
        md_files = list(today_path.glob("*.md"))
        print(f"✅ Found {len(md_files)} markdown files in today's folder")

        # Show the most recent few files
        recent_files = sorted(md_files, key=lambda f: f.stat().st_mtime, reverse=True)[:3]
        for f in recent_files:
            mtime = time.ctime(f.stat().st_mtime)
            print(f"   📄 {f.name} (modified: {mtime})")
        return True
    else:
        print(f"❌ No markdown folder found for today: {today_path}")
        return False

def main():
    """Run the complete integration test."""
    print("🚀 VoiceTree Integration Test")
    print("=" * 40)

    # Test 1: Health check
    print("\n1. Testing server health...")
    if not test_server_health():
        print("\n❌ Test failed: Server is not running")
        return

    # Test 2: Send text endpoint
    print("\n2. Testing /send-text endpoint...")
    if not test_send_text_endpoint():
        print("\n❌ Test failed: Cannot send text to server")
        return

    # Test 3: Check markdown updates
    print("\n3. Checking markdown tree updates...")
    check_markdown_tree_update()

    print("\n✅ Integration test complete!")
    print("\n🎯 Next steps:")
    print("   1. Open http://localhost:5173 in your browser")
    print("   2. Click 'Start Recording' and speak some text")
    print("   3. Click 'Send to VoiceTree' to test the full pipeline")

if __name__ == "__main__":
    main()