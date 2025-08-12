#!/usr/bin/env python3
import json
import sys
from datetime import datetime

# Log to a file to see when and how often the hook runs
with open('/tmp/hook_debug.log', 'a') as f:
    f.write(f"\n{datetime.now().isoformat()} - Hook called\n")
    
    try:
        input_data = json.load(sys.stdin)
        event = input_data.get('hook_event_name', 'unknown')
        f.write(f"  Event: {event}\n")
    except:
        f.write("  Failed to read input\n")

print("Debug hook ran")
sys.exit(0)